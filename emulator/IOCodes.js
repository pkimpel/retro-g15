/***********************************************************************
* retro-g15/emulator IOCodes.js
************************************************************************
* Copyright (c) 2022, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Input/Output subsystem constants for the G-15 emulator.
************************************************************************
* 2022-03-17  P.Kimpel
*   Original version.
***********************************************************************/

// Peripheral device data codes
export const ioDataMask =       0b10000;        // mask bit for data-valued I/O codes
export const ioCodeSpace =      0b00000;        // space/empty-frame code
export const ioCodeMinus =      0b00001;        // minus sign
export const ioCodeCR =         0b00010;        // carriage-return
export const ioCodeTab =        0b00011;        // tab
export const ioCodeStop =       0b00100;        // block end/stop code
export const ioCodeReload =     0b00101;        // buffer reload code (/)
export const ioCodePeriod =     0b00110;        // period character code
export const ioCodeWait =       0b00111;        // data-skip code

// I/O command codes
export const ioCmdCancel =      0b00000;        // cancel I/O in progress, set Ready
export const ioCmdMTWrite =     0b00001;        // magnetic tape write
export const ioCmdPunchLeader = 0b00010;        // fast punch tape leader
export const ioCmdFastPunch =   0b00011;        // fast punch line 19
export const ioCmdMTSearchRev = 0b00100;        // magnetic tape search reverse
export const ioCmdMTSearchFwd = 0b00101;        // magnetic tape search forward
export const ioCmdPTRev1 =      0b00110;        // paper tape reader reverse, phase 1
export const ioCmdPTRev2 =      0b00111;        // paper tape reader reverse, phase 2
export const ioCmdTypeAR =      0b01000;        // type AR, optionally punch
export const ioCmdType19 =      0b01001;        // type line 19, optionally punch
export const ioCmdPunch19 =     0b01010;        // punch line 19
export const ioCmdCardPunch19 = 0b01011;        // card punch line 19
export const ioCmdTypeIn =      0b01100;        // type in from keyboard
export const ioCmdMTRead =      0b01101;        // magnetic tape read
export const ioCmdCardRead =    0b01110;        // card read
export const ioCmdPTRead =      0b01111;        // paper tape read
export const ioCmdReady =       0b10000;        // set I/O ready status

// Filter ASCII character values to I/O frame code values.
export const ioCodeFilter = [
        // 0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
        0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,  // 00-0F
        0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,  // 10-1F
        0x00,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0x01,0x06,0x05,  // 20-2F
        0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,  // 30-3F
        0xFF,0xFF,0xFF,0x02,0x02,0xFF,0xFF,0xFF,0x07,0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,  // 40-4F
        0x0F,0xFF,0x05,0x04,0x03,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,0xFF,0xFF,0xFF,0xFF,0xFF,  // 50-5F
        0xFF,0xFF,0xFF,0x02,0x02,0xFF,0xFF,0xFF,0x07,0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,  // 60-6F
        0x0F,0xFF,0xFF,0x04,0x03,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,0xFF,0xFF,0xFF,0xFF,0xFF]; // 70-7F
