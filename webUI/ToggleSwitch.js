/***********************************************************************
* retro-g15/webUI ToggleSwitch.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* JavaScript class module for two-position toggle switch objects.
************************************************************************
* 2021-11-30  P.Kimpel
*   Original version, from retro-205 D205PanelUtil.js.
***********************************************************************/

export {ToggleSwitch};

class ToggleSwitch {

    constructor(parent, x, y, id, offImage, onImage) {
        /* Parameters:
            parent      the DOM container element for this switch object.
            x & y       coordinates of the lamp within its containing element.
            id          the DOM id for the lamp object.
            offImage    path to image for the switch in the off state.
            onImage     path to the image for the switch in the on state */

        this.state = 0;                     // current switch state, 0=off
        this.topCaptionDiv = null;          // optional top caption element
        this.bottomCaptionDiv = null;       // optional bottom caption element
        this.offImage = offImage;           // image used for the off state
        this.onImage = onImage;             // image used for the on state

        // visible DOM element
        this.element = document.createElement("img");
        this.element.id = id;
        this.element.src = offImage;
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
        /* Sets an event handler on the image element */

        this.element.addEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    removeEventListener(eventName, handler, useCapture) {
        /* Removess an event handler from the image element */

        this.element.removeEventListener(eventName, handler, useCapture);
    }

    /**************************************/
    set(state) {
        /* Changes the visible state of the switch according to the low-order
        bit of "state" */
        let newState = state & 1;

        if (this.state ^ newState) {         // the state has changed
            this.state = newState;
            this.element.src = (newState ? this.onImage : this.offImage);
        }
    }

    /**************************************/
    flip() {
        /* Complements the visible state of the switch */
        let newState = this.state ^ 1;

        this.state = newState;
        this.element.src = (newState ? this.onImage : this.offImage);
    }

    /**************************************/
    setCaption(caption, atBottom) {
        /* Establishes an optional caption at the top or bottom of a single switch.
        Returns the caption element */
        let e = (atBottom ? this.bottomCaptionDiv : this.topCaptionDiv);

        if (e) {
            e.textContent = caption;
        } else {
            e = document.createElement("div");
            if (atBottom) {
                this.bottomCaptionDiv = e;
                e.className = ToggleSwitch.bottomCaptionClass;
            } else {
                this.topCaptionDiv = e;
                e.className = ToggleSwitch.topCaptionClass;
            }
            e.appendChild(document.createTextNode(caption));
            this.element.appendChild(e);
        }
        return e;
    }

} // class ToggleSwitch


// Static class properties

ToggleSwitch.topCaptionClass = "toggleSwitchTopCaption";
ToggleSwitch.bottomCaptionClass = "toggleSwitchBottomCaption";
