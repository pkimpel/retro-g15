/***********************************************************************
* retro-1620/emulator WaitSignal.js
************************************************************************
* Copyright (c) 2025, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Class that creates a Promise that resolves once the instance is
* signaled that an event has taken place. Typically used in the I/O
* subsystem to wait for something to complete or become ready.
************************************************************************
* 2025-10-25  P.Kimpel
*   Original version, from retro-1620 WaitSignal.js.
***********************************************************************/

export {WaitSignal};

class WaitSignal {

    // Public Instance Properties

    resolver = null;                    // function reference to Promise resolver
    waiting = false;                    // wait has been waiting
    waitPromise = null;                 // promise we're waiting on


    /**************************************/
    wait() {
        /* Constructs a Promise that resolves when this.proceed() is called,
        then disables the signaling mechanism. The parameter to that function
        is a value that is returned to the caller.
        See: https://stackoverflow.com/questions/26150232/resolve-javascript-
        promise-outside-the-promise-constructor-scope */
        if (!this.waitPromise) {
            this.waiting = true;
            this.waitPromise = new Promise((resolve, reject) => {
                this.resolver = resolve;
            });
        }

        return this.waitPromise;
    }

    /**************************************/
    proceed(result) {
        /* Method to call when signaling that the wait has been completed */

        if (!this.waitPromise) {
            console.debug("<<< WaitSignal: no wait pending");
            throw new Error("WaitSignal: no wait pending");
        } else {
            const resolver = this.resolver;
            this.waitPromise = this.resolver = null;
            this.waiting = false;
            resolver(result);
        }
    }

} // class WaitSignal
