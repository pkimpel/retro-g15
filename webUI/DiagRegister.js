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

import {DiagLamp} from "./DiagLamp.js";

class DiagRegister {

    constructor(parent, bits, grouped, signed, idPrefix, caption) {
        /* Parameters:
            parent      the DOM element (usually a <div>) within which the register will be built.
            bits        number of bits in register.
            grouped     group lamps in 4-bit hex units
            signed      low-order lamp is the sign bit
            idPrefix    prefix string for the individual lamp ids.
            caption     optional caption displayed at the bottom of the register */

        let groups = (grouped ? Math.floor((bits+3-(signed ? 1 : 0))/4) : 1);   // number of hex bit-groups

        this.element = parent;          // containing element for the panel
        this.bits = bits;               // number of bits in the register
        this.grouped = grouped;         // lamps are groups in 4-bit units
        this.groups = groups;           // number of groups
        this.signed = signed            // low-order lamp is the sign bit
        this.caption = caption || "";   // panel caption
        this.lastValue = 0;             // prior register value
        this.lamps = new Array(bits);   // bit lamps

        let cx = bits*DiagRegister.hSpacing + DiagRegister.hOffset +
             (grouped ? (groups-1)*DiagRegister.groupSpacing : 0) +
             (signed ? DiagRegister.groupSpacing : 0);
        let gx = 0;                     // lamp-within-group index
        for (let b=0; b<bits; b++) {
            cx -= DiagRegister.hSpacing;
            this.lamps[b] = new DiagLamp(parent, cx, DiagRegister.vOffset, idPrefix + b.toString());
            if (signed) {
                signed = false;
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
        this.captionDiv.className = DiagRegister.captionClass;
        this.captionValue = null;
        if (caption) {
            this.captionDiv.appendChild(document.createTextNode(caption));
            if (bits > 1) {
                this.captionValue = document.createElement("span");
                this.captionDiv.appendChild(this.captionValue);
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
        let thisValue = Math.floor(Math.abs(value)) % 0x40000000;

        if (thisValue != lastValue) {
            let bitBase = 0;
            this.lastValue = thisValue; // save it for next time
            if (this.captionValue) {
                if (!this.signed) {
                    this.captionValue.textContent = "=" + thisValue.toString();
                } else {
                    this.captionValue.textContent = "=" +
                            ((thisValue & 1) ? "-" : "") + (thisValue >> 1).toString();
                }
            }

            do {
                // Loop through the masks 30 bits at a time so we can use Javascript bit ops
                let bitNr = bitBase;
                let lastMask = lastValue % 0x40000000;          // get the low-order 30 bits
                let thisMask = thisValue % 0x40000000;          // ditto for the second value
                lastValue = (lastValue-lastMask)/0x40000000;    // shift the value right 30 bits
                thisValue = (thisValue-thisMask)/0x40000000;

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


// Static class properties

DiagRegister.hSpacing = 10;             // horizontal lamp spacing, pixels
DiagRegister.hOffset = 4;               // horizontal lamp offset within container, pixels
DiagRegister.vOffset = 2;               // vertical lamp offset within container, pixels
DiagRegister.groupSpacing = 6;          // horizontal inter-group spacing, pixels
DiagRegister.lampHeight = 10;           // lamp outer height, pixels
DiagRegister.lampWidth = 6;             // lamp outer width, pixels
DiagRegister.panelClass = "diagRegister";
DiagRegister.captionClass = "diagRegCaption";
