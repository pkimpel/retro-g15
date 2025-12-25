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
export const drumLineSize = 124;                // words along drum circumference
export const longLineSize = 108;                // words per long drum line
export const fastLineSize = 4;                  // words per fast drum line
export const minTimeout = 4;                    // browsers will do setTimeout for at least 4ms

export const wordMask = 0x1FFFFFFF;             // 29 bits
export const absWordMask = 0x1FFFFFFE;          // all but the sign bit
export const wordSignMask = 0x01;               // sign bit mask
export const two28 = 0x10000000;                // 2**28 for complementing word magnitude values
export const two29 = 0x20000000;                // 2**29 for complementing full-word values

export const defaultRPM = 1800;                 // default drum revolution speed, rev/min
export const maxRPM = defaultRPM*100;           // maximum drum revolution speed, rev/min
export let nonStandardRPM = false;              // true if RPM has been changed from default
export let drumRPM = defaultRPM;                // drum revolution speed, rev/minute

// The following are constants once the drum RPM is determined.
export let wordTime = 0;                        // one word time on the drum [124 words/rev], ms
export let bitTime = 0;                         // one bit time on the drum, ms
export let drumCycleTime = 0;                   // one drum cycle (108 words), ms
export let timingFactor = 1;                    // global emulator speed factor

const hexRex = /[abcdefABCDEF]/g;               // standard hex characters
const g15HexXlate = {
        "a": "u", "A": "u",
        "b": "v", "B": "v",
        "c": "w", "C": "w",
        "d": "x", "D": "x",
        "e": "y", "E": "y",
        "f": "z", "F": "z"};

export const lineHex = [
        "00", "01", "02", "03", "04", "05", "06", "07", "08", "09",
        "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
        "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
        "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
        "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
        "50", "51", "52", "53", "54", "55", "56", "57", "58", "59",
        "60", "61", "62", "63", "64", "65", "66", "67", "68", "69",
        "70", "71", "72", "73", "74", "75", "76", "77", "78", "79",
        "80", "81", "82", "83", "84", "85", "86", "87", "88", "89",
        "90", "91", "92", "93", "94", "95", "96", "97", "98", "99",
        "u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9",
        "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9",
        "w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"];


/**************************************/
export function g15Hex(v) {
    /* Converts the value "v" to a hexidecimal string using the G-15
    convention. This is not a particularly efficient way to do this */

    return v.toString(16).replace(hexRex, (c) => {
        return g15HexXlate[c] ?? "?";
    }).padStart(7, "0");
}

/**************************************/
export function g15SignedHex(v) {
    /* Formats the value of "v" as signed G-15 hex */

    return g15Hex(v >> 1) + (v & wordSignMask ? "-" : " ");
}

/**************************************/
export function formatLineLoc(line, loc, isSource=false) {
    /* Formats a drum location as LL:TT(w), where LL is the drum line, TT is the
    timing location on the line, and (w) is the actual word location, but is
    present only for sources and destinations 20-26 and sources only 27 and 29-31 */
    let s = lineHex[loc];

    switch (line) {
    case 20:
    case 21:
    case 22:
    case 23:
        s += `/${loc%4}`;
        break;
    case 24:
    case 25:
    case 26:
        s += `/${loc%2}`;
        break;
    case 27:
    case 29:
    case 30:
    case 31:
        if (isSource) {
            s += `/${loc%4}`;
        } else {
            s += "  ";
        }
        break;
    default:
        s += "  ";
        break;
    }

    return s;
}

/**************************************/
export function formatDrumLoc(line, loc, isSource=false) {
    /* Formats a drum location as LL:TT/w, where LL is the drum line, TT is the
    timing location on the line, and /w is the actual drum location, but is
    present only for sources and destinations 20-26 and sources only 27 and 29-31 */

    return `${lineHex[line]}.${formatLineLoc(line, loc, isSource)}`;
}

/**************************************/
export function disassembleCommand(cmd) {
    /* Disassembles an instruction word, returning a string in a PPR-like format */
    const C1 = cmd & 0x01;                  // single/double mode
    const D =  (cmd >> 1) & 0x1F;           // destination line
    const S =  (cmd >> 6) & 0x1F;           // source line
    const C =  (cmd >> 11) & 0x03;          // characteristic code
    const N =  (cmd >> 13) & 0x7F;          // next command location
    const BP = (cmd >> 20) & 0x01;          // breakpoint flag
    const T =  (cmd >> 21) & 0x7F;          // operand timing number
    const DI = (cmd >> 28) & 0x01;          // immediate/deferred execution bit

    return (DI ? (D == 31 ? "w" : " ") : (D == 31 ? " " : "u")) +
           `.${lineHex[T]}.${lineHex[N]}.${C1*4 + C}.${lineHex[S]}.${lineHex[D]}${BP ? "-" : " "}`;
}

/**************************************/
export function setTiming(newRPM=defaultRPM) {
    /* Computes the drum timing factors from the specified drumRPM (default=1800) */

    if (newRPM >= 0 && newRPM <= maxRPM) {
        drumRPM = newRPM;                       // drum revolution speed, rev/minute
        timingFactor = drumRPM/defaultRPM;      // emulator speed factor
        wordTime = 60000/drumRPM/drumLineSize;  // one word time on the drum [124 words/rev], ms
        bitTime = wordTime/wordBits;            // one bit time on the drum, ms
        drumCycleTime = wordTime*longLineSize;  // one drum cycle (108 words), ms
    }
}

/**************************************/
export function enableNonStandardTiming(newRPM) {
    /* Enables non-standrd emulator timing (called by G15.js initialization */

    nonStandardRPM = true;
    setTiming(newRPM);
}


/***********************************************************************
*  Timer Class                                                         *
***********************************************************************/

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
