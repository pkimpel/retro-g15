/***********************************************************************
* retro-g15/emulator Util.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* General constants and utilities for the G-15 emulator.
************************************************************************
* 2022-03-08  P.Kimpel
*   Original version.
***********************************************************************/

export const wordBits = 29;                     // bits per G-15 word
export const wordMagBits = 28;                  // magnitude bits in a G-15 word
export const wordBytes = 4;                     // bytes per G-15 word (32 bits holding 29 bits)
export const longLineSize = 108;                // words per long drum line
export const fastLineSize = 4;                  // words per fast drum line
export const minTimeout = 4;                    // browsers will do setTimeout for at least 4ms

export const wordMask = 0x1FFFFFFF;             // 29 bits
export const absWordMask = 0x1FFFFFFE;          // all but the sign bit
export const wordSignMask = 0x01;               // sign bit mask
export const two28 = 0x10000000;                // 2**28 for complementing word magnitude values

export const defaultRPM = 1800;                 // default drum revolution speed, rev/min
export let drumRPM = defaultRPM;                // drum revolution speed, rev/minute
export let wordTime = 0;                        // one word time on the drum [124 words/rev], ms
export let bitTime = 0;                         // one bit time on the drum, ms
export let drumCycleTime = 0;                   // one drum cycle (108 words), ms

const hexRex = /[abcdefABCDEF]/g;               // standard hex characters
const g15HexXlate = {
        "a": "u", "A": "u",
        "b": "v", "B": "v",
        "c": "w", "C": "w",
        "d": "x", "D": "x",
        "e": "y", "E": "y",
        "f": "z", "F": "z"};


/**************************************/
export function g15Hex(v) {
    /* Converts the value "v" to a hexidecimal string using the G-15
    convention. This is not a particularly efficient way to do this */

    return v.toString(16).replace(hexRex, (c) => {
        const g = g15HexXlate[c];
        return (g ? g : "?");
    });
}

/**************************************/
export function g15SignedHex(v) {
    /* Formats the value of "v" as signed G-15 hex */

    return g15Hex(v >> 1) + (v & 1 ? "-" : " ");
}

/**************************************/
export function setTiming(newRPM=defaultRPM) {
    /* Computes the drum timing factors from the specified drumRPM (default=1800) */

    if (newRPM >= defaultRPM) {
        drumRPM = newRPM;               // drum revolution speed, rev/minute
        wordTime = 60000/drumRPM/124;   // one word time on the drum [124 words/rev], ms
        bitTime = wordTime/wordBits;    // one bit time on the drum, ms
        drumCycleTime = wordTime*longLineSize;
                                        // one drum cycle (108 words), ms
    }
}


/**************************************/
export class Timer {

    constructor() {
        /* Constructor for a Timer object that wraps setTimeout() */

        this.rejector = null;
        this.timerHandle = 0;
        this.value = null;
    }

    set(delay, value) {
        /* Initiates the timer for "delay" milliseconds and returns a Promise that
        will resolve when the timer expires. The "value" parameter is optional and
        will become the value returned by the Promise */

        if (delay <= minTimeout) {
            return Promise.resolve(value);
        } else {
            return new Promise((resolve, reject) => {
                this.value = value;
                this.rejector = reject;
                this.timerHandle = setTimeout(() => {
                    resolve(this.value);
                    this.rejector = null;
                    this.value = null;
                    this.timerHandle = 0;
                }, delay);
            });
        }
    }

    delayUntil(then, value) {
        /* Initiates the timer for a delay until performance.now() reaches "then".
        "value" is the same as for set(). Returns a Promise that resolves when
        the time is reached */

        return this.set(then - performance.now(), value);
    }

    clear() {
        /* Clears the timer if it is set */

        if (this.timerHandle !== 0) {
            clearTimeout(this.timerHandle);
            this.rejector = null;
            this.value = null;
            this.timerHandle = 0;
        }
    }

    reject() {
        /* Clears the timer if it is set and rejects the Promise */

        if (this.timerHandle !== 0) {
            this.rejector();
            this.clear();
        }
    }
}

/***********************************************************************
*  Global Initialization Code                                          *
***********************************************************************/

setTiming(defaultRPM);
