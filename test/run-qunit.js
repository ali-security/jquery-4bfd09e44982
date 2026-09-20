#!/usr/bin/env node
/**
 * Headless runner for the jQuery unit suite.
 *
 * Upstream drove test/index.html through TestSwarm on real browsers, so the
 * repo has no way to run its own QUnit suite from the command line. This loads
 * the same test/index.html in headless Chrome, against a PHP server so the
 * .php-backed ajax fixtures work, and reports every test QUnit ran.
 *
 * Usage: node test/run-qunit.js <url> [module]
 * Exits non-zero when any test fails or the run does not finish.
 */
"use strict";

var puppeteer = require( "puppeteer-core" ),

	base = process.argv[ 2 ] || "http://127.0.0.1:8080/test/index.html",
	module_ = process.argv[ 3 ] || "",
	url = module_ ? base + "?module=" + encodeURIComponent( module_ ) : base,
	timeoutMs = 15 * 60 * 1000;

( async function() {
	var browser = await puppeteer.launch( {
		executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
		headless: true,
		args: [ "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
			"--disable-gpu" ]
	} );

	var page = await browser.newPage(),
		resolveDone,
		done = new Promise( function( res ) {
			resolveDone = res;
		} ),
		timedOut = false;

	page.on( "pageerror", function( err ) {
		process.stderr.write( "PAGE ERROR: " + err.message + "\n" );
	} );

	await page.exposeFunction( "__qunitDone", function( data ) {
		resolveDone( data );
	} );

	await page.evaluateOnNewDocument( function() {
		var register = function() {
			if ( window.QUnit && window.QUnit.done ) {
				window.QUnit.done( function( data ) {
					window.__qunitDone( data );
				} );
			} else {
				setTimeout( register, 50 );
			}
		};
		register();
	} );

	console.log( "Running the jQuery unit suite: " + url );
	await page.goto( url, { waitUntil: "domcontentloaded", timeout: 60000 } );

	var summary = await Promise.race( [ done, new Promise( function( res ) {
		setTimeout( function() {
			timedOut = true;
			res( null );
		}, timeoutMs );
	} ) ] );

	var results = await page.evaluate( function() {
		return Array.prototype.map.call(
			document.querySelectorAll( "#qunit-tests > li" ),
			function( li ) {
				var name = li.querySelector( ".test-name" ),
					mod = li.querySelector( ".module-name" ),
					counts = li.querySelector( ".counts" );
				return {
					status: li.className.trim(),
					module: mod ? mod.textContent : "",
					test: name ? name.textContent : "",
					counts: counts ? counts.textContent : ""
				};
			}
		);
	} );

	await browser.close();

	results.forEach( function( r ) {
		console.log( ( r.status === "pass" ? "PASS" : "FAIL" ) + ": " +
			( r.module ? r.module + ": " : "" ) + r.test + " " + r.counts );
	} );

	var failed = results.filter( function( r ) {
		return r.status !== "pass";
	} );

	console.log( "\nTests executed: " + results.length +
		", passed: " + ( results.length - failed.length ) +
		", failed: " + failed.length );
	if ( summary ) {
		console.log( "Assertions: " + summary.total + ", passed: " + summary.passed +
			", failed: " + summary.failed + ", runtime: " + summary.runtime + "ms" );
	}

	if ( timedOut ) {
		console.error( "The suite did not finish within the timeout." );
		process.exit( 1 );
	}
	if ( failed.length || !results.length ) {
		process.exit( 1 );
	}
	console.log( "jQuery unit suite passed." );

	// Chrome's transport keeps handles open; exit explicitly so the CI step ends.
	process.exit( 0 );
}() ).catch( function( err ) {
	console.error( err );
	process.exit( 1 );
} );
