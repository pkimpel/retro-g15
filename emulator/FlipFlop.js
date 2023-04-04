/***********************************************************************
* retro-g15/emulator FlipFlop.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for an internal processor flip-flop with lamp
* intensity averaging for neon bulbs.
************************************************************************
* 2021-12-10  P.Kimpel
*   Original version, from retro-220 B220Processor.js.
***********************************************************************/

export {FlipFlop}

import * as Util from "./Util.js";

class FlipFlop {

    constructor(clock, invisible) {
        /* Constructor for the generic FlipFlop class. "clock" is a reference to
        the object that maintains the emulation clock, which must support the
        property "eTime". That property reports the current emulation time in
        milliseconds. Emulation time is used to compute lamp glow decay and a
        time-weighted exponential average intensity.

        "invisible" should be true if the register does not have a visible
        presence in the UI -- this will inhibit computing average lamp glow
        values for the register.

        Note that it is important to increment clock.eTime in the caller AFTER
        setting new values in registers and flip-flops. This allows the average
        intensity to be computed based on the amount of time a bit was actually in
        that state */

        this.visible = (invisible ? false : true);
        this.lastETime = 0;             // time flip-flop was last set
        this.clock = clock;             // processor instance
        this.intVal = 0;                // binary value of flip-flop: read-only externally
        this.glow = 0;                  // average lamp glow value
    }

    get value() {
        return this.intVal;
    }

    set value(value) {
        this.set(value);
    }

    /**************************************/
    updateLampGlow(beta) {
        /* Updates the average glow for the flip flop. Note that the glow is
        always aged by at least one clock tick. Beta is a bias in the
        range (0,1). For normal update, use 0; to freeze the current state, use 1 */
        let eTime = this.clock.eTime;

        if (this.visible) {
            let alpha = Math.min(Math.max(eTime-this.lastETime, Util.bitTime)/
                                 FlipFlop.neonPersistence + beta, 1.0);
            this.glow = this.glow*(1.0-alpha) + this.intVal*alpha;
        }

        this.lastETime = eTime;
    }

    /**************************************/
    set(value) {
        /* Set the value of the FF. Use this rather than setting the intVal member
        directly so that average lamp glow can be computed. Returns the new value */

        if (this.visible) {
            this.updateLampGlow(0);
        }

        this.intVal = (value ? 1 : 0);
        return this.intVal;
    }

    /**************************************/
    flip() {
        /* Complement the value of the FF. Returns the new value */

        return this.set(1-this.intVal);
    }

} // class FlipFlop


// Static class properties

FlipFlop.neonPersistence = 15;          // persistence of neon bulb glow [ms] // ** was 7 ** \\
