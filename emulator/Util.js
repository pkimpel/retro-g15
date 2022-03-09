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
export const wordBytes = 4;                     // bytes per G-15 word (32 bits holding 29 bits)
export const longLineSize = 108;                // words per long drum line
export const fastLineSize = 4;                  // words per fast drum line

export const wordMask = 0x1FFFFFFF;             // 29 bits
export const absWordMask = 0x1FFFFFFE;          // all but the sign bit
export const two28 = 0x10000000;                // 2**28 for complementing word values

export const wordTime = 60000/1800/124;         // one word time on the drum [1800 RPM, 124 words/rev], ms
export const bitTime = wordTime/wordBits;       // one bit time on the drum, ms
export const drumCycleTime = wordTime*longLineSize;
                                                // one drum cycle (108 words), ms