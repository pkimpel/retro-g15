/***********************************************************************
* retro-g15/webUI DiagRegister.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for arrays of DiagLamp objects as registers.
************************************************************************
* 2021-12-28  P.Kimpel
*   Original version, from PanelRegister.js.
***********************************************************************/

export {DiagRegister};

import * as Util from "../emulator/Util.js";
import {DiagLamp} from "./DiagLamp.js";

class DiagRegister {



// Static class properties

    static hSpacing = 10;               // horizontal lamp spacing, pixels
    static hOffset = 4;                 // horizontal lamp offset within container, pixels
    static vOffset = 2;                 // vertical lamp offset within container, pixels
    static groupSpacing = 6;            // horizontal inter-group spacing, pixels
    static lampHeight = 8;              // lamp outer height, pixels
    static lampWidth = 6;               // lamp outer width, pixels
    static two30 = 0x40000000;          // 2**30
    static panelClass = "diagRegister";
    static captionClassCenter = "diagCaptionCenter";
    static captionClassRight = "diagCaptionRight";


    constructor(parent, bits, grouped, format, idPrefix, caption) {
        /* Parameters:
            parent      the DOM element (usually a <div>) within which the register will be built.
            bits        number of bits in register.
            grouped     group lamps in 4-bit hex units
            format      mask of format options:
                          0x01 signed: low-order lamp is the sign bit
                          0x02 0=partial word: centered/caption on left,
                               1=full word: right-justified/caption on right
                          0x04 0=hex value, 1=decimal value
                          0x08 0=even or only word, 1=odd word of a two-word pair
            idPrefix    prefix string for the individual lamp ids.
            caption     optional caption displayed above the register */

        this.element = parent;          // containing element for the panel
        this.bits = bits;               // number of bits in the register
        this.grouped = grouped;         // lamps are groups in 4-bit units
        this.caption = caption || "";   // panel caption
        this.lastValue = 1;             // prior register value

        this.signed = format & 1;
        this.fullWord = (format >> 1) & 1;
        this.decimal = (format >> 2) & 1;
        this.oddWord = (format >> 3) & 1;

        this.lamps = new Array(bits);   // bit lamps
        this.groups = (grouped ? Math.floor((bits+3-(this.signed ? 1 : 0))/4) : 1);  // number of hex bit-groups

        let cx = bits*DiagRegister.hSpacing + DiagRegister.hOffset +
             (grouped ? (this.groups-1)*DiagRegister.groupSpacing : 0) +
             (this.signed ? DiagRegister.groupSpacing : 0);
        let gx = 0;                     // lamp-within-group index
        let signNeeded = this.signed;
        for (let b=0; b<bits; b++) {
            cx -= DiagRegister.hSpacing;
            this.lamps[b] = new DiagLamp(parent, cx, DiagRegister.vOffset, idPrefix + b.toString());
            if (signNeeded) {
                signNeeded = false;
                cx -= DiagRegister.groupSpacing;
            } else if (grouped) {
                if (++gx >= 4) {
                    gx = 0;
                    cx -= DiagRegister.groupSpacing;
                }
            }
        }

        parent.style.width = this.panelWidth(bits).toString() + "px";
        parent.style.height = this.panelHeight().toString() + "px";
        this.captionDiv = document.createElement("div");
        this.captionDiv.className = this.fullWord ?
                DiagRegister.captionClassRight : DiagRegister.captionClassCenter;
        if (!caption) {
            this.caption1Value = this.caption2Value = null;
        } else {
            const captionNode = document.createTextNode(caption);
            this.captionDiv.appendChild(captionNode);
            if (bits > 1) {
                this.caption1Value = document.createElement("span");
                if (this.fullWord) {
                    this.caption2Value = document.createElement("span");
                    this.captionDiv.insertBefore(this.caption1Value, captionNode);
                    this.captionDiv.insertBefore(this.caption2Value, this.caption1Value);
                } else {
                    this.captionDiv.appendChild(document.createTextNode("="));
                    this.captionDiv.appendChild(this.caption1Value);
                }
            }
        }

        parent.appendChild(this.captionDiv);
    }

    /**************************************/
    panelWidth(cols) {
        /* Returns the width of a register panel in pixels */

        return (cols-1)*DiagRegister.hSpacing + DiagRegister.hOffset*2 + DiagRegister.lampWidth +
               (this.grouped ? (this.groups-1)*DiagRegister.groupSpacing : 0) +
               (this.signed ? DiagRegister.groupSpacing : 0);
    }

    /**************************************/
    panelHeight() {
        /* Returns the height of a register panel in pixels */

        return DiagRegister.vOffset*2 + DiagRegister.lampHeight;
    }

    /**************************************/
    update(value) {
        /* Update the register lamps from the value of the parameter. This routine
        compares the value of the register that was previously updated against the new
        one in an attempt to minimize the number of lamp flips that need to be done */
        let lastValue = this.lastValue;
        let thisValue = Math.floor(Math.abs(value)) % DiagRegister.two30;

        if (thisValue != lastValue) {
            this.lastValue = thisValue; // save it for next time
            let bitBase = 0;
            let sign = "";
            if (this.signed) {
                if (thisValue & 1) {
                    sign = "-";
                    thisValue >>= 1;
                    thisValue = (Util.two28 - thisValue) % Util.two28;
                } else {
                    thisValue >>= 1;
                }
            }

            if (this.caption1Value) {
                this.caption1Value.textContent = this.decimal ?
                        sign + thisValue.toString() : Util.lineHex[thisValue];
            }

            if (this.caption2Value) {
                this.caption2Value.textContent =
                        (thisValue/(this.signed ? Util.two28 : Util.two29)).toFixed(9) + sign;
            }

            do {
                // Loop through the masks 30 bits at a time so we can use Javascript bit ops
                let bitNr = bitBase;
                let lastMask = lastValue % DiagRegister.two30;          // get the low-order 30 bits
                let thisMask = thisValue % DiagRegister.two30;          // ditto for the second value
                lastValue = (lastValue-lastMask)/DiagRegister.two30;    // shift the value right 30 bits
                thisValue = (thisValue-thisMask)/DiagRegister.two30;

                lastMask ^= thisMask;       // determine which bits have changed
                while (lastMask) {
                    if (lastMask & 0x01) {
                        this.lamps[bitNr].set(thisMask & 0x01);
                    }
                    if (++bitNr <= this.bits) {
                        lastMask >>>= 1;
                        thisMask >>>= 1;
                    } else {
                        thisValue = thisMask = 0;
                        lastValue = lastMask = 0;
                        break;              // out of inner while loop
                    }
                }

                bitBase += 30;
            } while (thisValue || lastValue);
        }
    }

    /**************************************/
    updateLampGlow(glow) {
        /* Update the register lamps from the bitwise intensity values in "glow" */

        for (let bitNr=this.bits-1; bitNr>=0; --bitNr) {
            this.lamps[bitNr].set(glow[bitNr]);
        }
    }

    /**************************************/
    updateFromRegister(reg) {
        /* Update the register value and lamp glow from a Register object */

        this.update(reg.value);
        this.updateLampGlow(reg.glow);
    }

} // class DiagRegister
