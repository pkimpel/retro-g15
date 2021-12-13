/***********************************************************************
* retro-g15/emulator Register.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for an internal processor register with lamp
* intensity averaging for neon bulbs.
************************************************************************
* 2021-12-08  P.Kimpel
*   Original version, from retro-220 B220Processor.js.
***********************************************************************/

export {Register}

import {Drum} from "./Drum.js";
import {BitField} from "./BitField.js";
import {FlipFlop} from "./FlipFlop.js";

class Register {

    constructor(bits, clock, invisible) {
        /* Constructor for the generic Register class. Defines a binary register
        of "bits" bits. "clock" is a reference to the object that maintains the
        emulation clock, which must support the property "eTime". That property
        reports the current emulation time in milliseconds. Emulation time is
        used to lamp glow decay and a time-weighted exponential average intensity.

        "invisible" should be true if the register does not have a visible
        presence in the UI -- this will inhibit computing average lamp glow values
        for the register.

        Note that it is important to increment clock.eTime in the caller AFTER
        setting new values in registers and flip-flops. This allows the average
        intensity to be computed based on the amount of time a bit was actually in
        that state */

        this.bits = bits;               // number of bits in register
        this.visible = (invisible ? false : true);
        this.lastETime = 0;             // emulation time register was last set
        this.clock = clock;             // local copy of clock object
        this.intVal = 0;                // binary value of register: read-only externally

        this.glow = new Float64Array(bits);     // average lamp glow values
    }

    get value() {
        return this.intVal;
    }

    set value() {
        return this.set(value);
    }

    /**************************************/
    updateLampGlow(beta) {
        /* Updates the lamp glow averages based on this.clock.eTime. Note that the
        glow is always aged by at least one clock tick. Beta is a bias in the
        range (0,1). For normal update, use 0; to freeze the current state, use 1 */
        let eTime = this.clock.eTime;

        if (this.visible) {
            let alpha = Math.min(Math.max(eTime-this.lastETime, Drum.bitTime)/
                                 FlipFlop.neonPersistence + beta, 1.0);
            let alpha1 = 1.0-alpha;
            let b = 0;
            let bit = 0;
            let v = this.intVal;

            while (v) {
                bit = v % 2;
                v = (v-bit)/2;
                this.glow[b] = this.glow[b]*alpha1 + bit*alpha;
                ++b;
            }

            while (b < this.bits) {
                this.glow[b] *= alpha1;
                ++b;
            }
        }

        this.lastETime = eTime;
    }

    /**************************************/
    set(value) {
        /* Set a binary value into the register. Use this rather than setting
        the value member directly so that average lamp glow can be computed.
        Returns the new value */

        this.intVal = value % (1 << this.bits);
        if (this.visible) {
           this.updateLampGlow(0);
        }

        return value;
    }

    /**************************************/
    getBit(bitNr) {
        /* Returns the value of a bit in the register */

        return (bitNr < this.bits ? BitField.bitTest(this.intVal, bitNr) : 0);
    }

    /**************************************/
    setBit(bitNr, value) {
        /* Set a bit on or off in the register. Returns the new register value.
        Note that the glow is always aged by at least one clock tick */
        let eTime = this.clock.eTime;

        if (bitNr < this.bits) {
            let bit = (value ? 1 : 0);

            // Update the lamp glow for the former state.
            if (this.visible) {
                let alpha = Math.min(Math.max(eTime-this.lastETime, Drum.bitTime)/
                                     FlipFlop.neonPersistence + beta, 1.0);
                this.glow[bitNr] = this.glow[bitNr]*(1.0-alpha) + bit*alpha;
            }

            // Set the new state.
            this.intVal = (bit ? BitField.bitSet(this.intVal, bitNr) : BitField.bitReset(this.intVal, bitNr));
        }

        return this.intVal;
    }

    /**************************************/
    flipBit(bitNr) {
        /* Complements a bit in the register. Returns the new register value. Note
        that the glow is always aged by at least one clock tick */
        let eTime = this.clock.eTime;

        if (bitNr < this.bits) {
            let bit = 1 - BitField.bitTest(this.intVal, bitNr);

            // Update the lamp glow for the former state.
            if (this.visible) {
                let alpha = Math.min(Math.max(eTime-this.lastETime, Drum.bitTime)/
                                     FlipFlop.neonPersistence + beta, 1.0);
                this.glow[bitNr] = this.glow[bitNr]*(1.0-alpha) + bit*alpha;
            }

            // Set the new state.
            this.intVal = BitField.bitFlip(this.intVal, bitNr);
        }

        return this.intVal;
    }

} // class Register


// Static class properties
