/***********************************************************************
* retro-g15/webUI DiagLamp.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for neon lamp panel objects.
************************************************************************
* 2021-12-28  P.Kimpel
*   Original version, cloned from NeonLamp.js.
***********************************************************************/

export {DiagLamp};

class DiagLamp {

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
        this.element.className = DiagLamp.lampClass;
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
        let newState = Math.max(Math.min(Math.round(state*DiagLamp.lampLevels + 0.4999),
                                         DiagLamp.lampLevels), 0);

        if (this.state ^ newState) {         // the state has changed
            this.state = newState;
            this.element.className = DiagLamp.levelClass[newState];
        }
    }

    /**************************************/
    flip() {
        /* Complements the visible state of the lamp */

        this.set(1.0 - this.state/DiagLamp.lampLevels);
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
                e.className = DiagLamp.bottomCaptionClass;
            } else {
                this.topCaptionDiv = e;
                e.className = DiagLamp.topCaptionClass;
            }
            e.appendChild(document.createTextNode(caption));
            this.element.appendChild(e);
        }
        return e;
    }

    /**************************************/
    updateFromFlipFlop(ff) {
        /* Update the lamp state from a FlipFlop object */

        this.set(ff.glow);
    }

} // class DiagLamp


// Static class properties

DiagLamp.lampClass = "diagLamp";
DiagLamp.litClass = "diagLamp diagLit";
DiagLamp.lampLevels = 6;
DiagLamp.levelClass = [                 // CSS class names for the lamp levels
            DiagLamp.lampClass,
            DiagLamp.litClass + "1",
            DiagLamp.litClass + "2",
            DiagLamp.litClass + "3",
            DiagLamp.litClass + "4",
            DiagLamp.litClass + "5",
            DiagLamp.litClass];
DiagLamp.topCaptionClass = "diagLampTopCaption";
DiagLamp.bottomCaptionClass = "diagLampBottomCaption";
