/***********************************************************************
* retro-g15/webUI NeonLamp.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for neon lamp panel objects.
************************************************************************
* 2021-11-30  P.Kimpel
*   Original version, from retro-205 D205PanelUtil.js.
***********************************************************************/

export {NeonLamp};

class NeonLamp {

    constructor(parent, x, y, id) {
        /* Parameters:
            parent      the DOM container element for this lamp object.
            x & y       coordinates of the lamp within its containing element.
            id          the DOM id for the lamp object */

        this.state = 0;                     // current lamp state, 0=off
        this.topCaptionDiv = null;          // optional top caption element
        this.bottomCaptionDiv = null;       // optional bottom caption element

        // visible DOM element
        this.element = document.createElement("div");
        this.element.id = id;
        this.element.className = NeonLamp.lampClass;
        if (x !== null) {
            this.element.style.left = x.toString() + "px";
        }
        if (y !== null) {
            this.element.style.top = y.toString() + "px";
        }

        if (parent) {
            parent.appendChild(this.element);
        }
    }

    /**************************************/
    addEventListener(eventName, handler, useCapture) {
        /* Sets an event handler whenever the image element is clicked */

        this.element.addEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    set(state) {
        /* Changes the visible state of the lamp according to the value of "state", 0-1 */
        let newState = Math.max(Math.min(Math.round(state*NeonLamp.lampLevels + 0.4999),
                                         NeonLamp.lampLevels), 0);

        if (this.state ^ newState) {         // the state has changed
            this.state = newState;
            this.element.className = NeonLamp.levelClass[newState];
        }
    }

    /**************************************/
    flip() {
        /* Complements the visible state of the lamp */

        this.set(1.0 - this.state/NeonLamp.lampLevels);
    }

    /**************************************/
    setCaption(caption, atBottom) {
        /* Establishes an optional caption at the top or bottom of a single lamp.
        Returns the caption element */
        let e = (atBottom ? this.bottomCaptionDiv : this.topCaptionDiv);

        if (e) {
            e.textContent = caption;
        } else {
            e = document.createElement("div");
            if (atBottom) {
                this.bottomCaptionDiv = e;
                e.className = NeonLamp.bottomCaptionClass;
            } else {
                this.topCaptionDiv = e;
                e.className = NeonLamp.topCaptionClass;
            }
            e.appendChild(document.createTextNode(caption));
            this.element.appendChild(e);
        }
        return e;
    }

} // class NeonLamp


// Static class properties

NeonLamp.topCaptionClass = "neonLampTopCaption";
NeonLamp.bottomCaptionClass = "neonLampBottomCaption";
NeonLamp.lampClass = "neonLamp";
NeonLamp.litClass = "neonLamp neonLit";
NeonLamp.lampLevels = 6;
NeonLamp.levelClass = [                 // CSS class names for the lamp levels
            NeonLamp.lampClass,
            NeonLamp.litClass + "1",
            NeonLamp.litClass + "2",
            NeonLamp.litClass + "3",
            NeonLamp.litClass + "4",
            NeonLamp.litClass + "5",
            NeonLamp.litClass];
