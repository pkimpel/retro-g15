/***********************************************************************
* retro-g15/webUI Plotter.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 Model 2 Emulator PA-3 Plotter device.
*
* Defines the plotter device. The device uses a <canvas> element for its
* drawing surface. The canvas coordinate system has the X-axis along the
* horizontal dimension and the Y-axis along the vertical dimension, with
* coordinate values increasing from left to right and top to bottom.
*
* The PA-3 (a rebranded CALCOMP 560R) did not have a coordinate system.
* It simply moved in 0.01-inch increments one step at a time in one of
* eight directions, left/right, up/down, and along the two diagnonals.
* See the PA-3 Plotter Manual for a description of the commands:
* https://rbk.delosent.com/allq/Q2800.pdf.
*
* The plotter worked by moving its pen horizontally along a carriage.
* The paper underneath the pen was moved up and down by a rotating, pin-
* feed drum. The paper unspooled from a roll at the back of the device,
* across the top, down under the pen, and out the bottom of the device,
* where it was either wound on a take-up roll or allowed to fall loose
* below the plotter. Thus, the area being plotted moved upward as the
* paper moved downward.
*
* That orientation is the opposite from the way that most GUI windows
* scroll, so in this emulation, the plotter is effectively turned upside
* down, as if the supply spool was on the bottom and the take-up spool
* on the top. As the plot advances, the image moves downward and the
* plotting area moves upward. Note that the usual convention with the
* PA-3 was that the X-axis was considered to be vertical (along the
* length of the paper) and the Y-axis was horizontal across the front
* of the plotter.
*
* Therefore, in this emulation, X-axis coordinates increase as the plot
* moves down the plotter's window, and Y-axis coordinates increase as
* the pen moves to the right. The (0,0) coordinate is at the mid-right
* of the plotting area. All of this will make much better sense if you
* watch the emulated plotter while standing on your head.
*
* The system configuration has an option to size the display of the
* plotting area at 100% (one css pixel per plotter step) or 50% (one
* css pixel for every two steps). The 50% setting is recommended for
* general use. The plotting area is not scaled, only the display of it.
*
* Different browsers support different maximum sizes of the <canvas>
* element. As of late 2023, desktop versions of the following browsers
* support maximum coordinate values of: Firefox 32767, Chrome and Edge
* 65535, Apple Safari 4,194,303 in width and 8,388,607 in height.
* There are further restrictions on the total area of a canvas.
* See https://github.com/jhildenbiddle/canvas-size#test-results.
*
* This implementation currently uses a canvas width of 1100 pixels and
* allows the height to be selected in the system configuration. One of
* several height values can be selected, ranging from 2048 to 32767
* pixels. Smaller heights generally result in better drawing performance.
* At or above a height of 16384 pixels, performance in most browsers
* becomes poor, althogh the actual effect varies by browser. The default
* height is 4096 pixels, allowing a drawing of 11 inches wide by almost
* 41 inches long.
*
* Note that canvas pixels are not the same as css (window) pixels,
* except at a scale factor of 1.000 (100%). At 50% scale, there are
* two canvas pixels per css pixels, but that relationship will change
* as the Plotter window is resized.
*
* See the wiki on the device for more information:
* https://github.com/pkimpel/retro-g15/wiki/UsingThePlotter.
*
************************************************************************
* 2026-02-08  P.Kimpel
*   Original version, from retro-1620 Plotter.js.
***********************************************************************/

export {Plotter};

import * as Util from "../emulator/Util.js";
import {openPopup} from "./PopupUtil.js";

class Plotter {

    // Static properties

    // static fpsAlpha = 0.01;             // alpha for moving exponential average frames/sec
    static minWait = 7;                 // minimum accumulated delay before throttling, ms
    static penPeriod = 145;             // time for pen up/down, ms
    static stepPeriod = 1000/200;       // time per pen step, ms
    static windowHeight = 488;          // window height, css pixels
    static windowExtraWidth = 93;       // window non-canvas width, css pixels:
                                        //     ControlDiv=68, scrollbar=17, margin=4+4

    static canvasStepSize = 0.01;       // plotter step size, inches
    static canvasMaxHeight = 32767;     // max canvas step height, about 27.3 feet
    static canvasMaxWidth = 1100;       // max canvas step width, 11 inches
    static canvasHOffset =              // canvas coordinate horizontal offset
                Plotter.canvasMaxWidth-1;
    static canvasVOffset = 0;           // canvas coordinate vertical offset
    static vCursorTopFactor = 0.50;     // top scrolling boundary offset factor
    static vCursorBottomFactor = 0.50;  // bottom scrolling boundary offset factor


    // Public Instance Properties (more in contructor and plotterOnLoad method)

    doc = null;                         // window document object
    window = null;                      // window object

    busy = false;                       // I/O in progress (not really used)
    canvasLineOffset = 0;               // offset from (X,Y) coordinate to center a point on the coordinate
    canvasLineWidth = 1;                // width of dots drawn by plotter steps, canvas units
    canvasMaxHeight = 0;                // maximum canvas height, canvas pixels
    cxLast = 0;                         // last horizontal canvas coord
    cyLast = 0;                         // last vertical canvas coord
    // fps = 60.0;                         // moving exponential average frames/sec
    frameLastStamp = performance.now(); // last animation frame timestamp
    innerHeight = 0;                    // window inner height, css pixels
    innerWidth = 0;                     // window inner width, css pixels
    movingFast = false;                 // true if doing manual fast move
    outputReadyStamp = 0;               // timestamp when ready for next plotter step
    penDown = false;                    // pen up=false, down=true
    stepCache = new Array(20);          // cache of steps to be drawn at next frame time as x,y pairs
    stepCacheToken = 0;                 // cancellation token for requestAnimationFrame
    stepCacheTop = 0;                   // current length of this.stepCache
    stepXLast = 0;                      // last cached X canvas pixel coord
    stepYLast = 0;                      // last cached Y canvas pixel coord
    timer = new Util.Timer();           // delay management timer
    vCursorBottom = 0;                  // current bottom cursor scrolling boundary offset, css pixels
    vCursorOffset = 0;                  // current offset of the vertical-coordinate cursor, css pixels
    vCursorTop = 0;                     // current top cursor scrolling boundary offset, css pixels
    viewHeight = 0;                     // current canvas height, css pixels
    viewScaleFactor = 1;                // current scale factor of viewed canvas
    viewScrollLimit = 0;                // current max vertical offset where scrolling is allowed, css pixels
    viewScrollMax = 0;                  // current max view scroll offset, css pixels
    viewScrollOffset = 0;               // amount view has been scrolled, css pixels
    viewSlideOffset = 0;                // offset of canvas in <iframe> to keep cursor in middle of view, css pixels
    viewWidth = 0;                      // current canvas width, css pixels
    visibleCarriage = false;            // true if pen carriage is visible
    windowLeft = 0;                     // window initial left offset
    windowTop = 0;                      // window initial top offset
    x = 0;                              // vertical offset (to down on the canvas)
    xMax = 0;                           // maximum vertical offset attained
    xMin = 0;                           // minimum vertical offset attained
    y = 0;                              // horizontal offset (to left on the canvas)
    yMax = 0;                           // maximum horizontal offset attained
    yMin = 0;                           // minimum horizontal offset attained


    constructor(context) {
        /* Initializes andthe plotter device. "context" is an object passing
        other objects and callback functions from the global script:
            config is the SystemConfig object
            processor is the Processor object
        Additional properties are created in the plotterOnLoad method */

        this.context = context;
        this.config = context.config;
        this.processor = context.processor;

        this.boundChangeLineWidth = this.changeLineWidth.bind(this);
        this.boundControlClick = this.controlClick.bind(this);
        this.boundControlMouseDown = this.controlMouseDown.bind(this);
        this.boundControlMouseUp = this.controlMouseUp.bind(this);
        this.boundDrawSteps = this.drawSteps.bind(this);
        this.boundResizeWindow = this.resizeWindow.bind(this);
        this.boundRestoreWindowGeometry = this.restoreWindowGeometry.bind(this);
        this.boundToggleVisibleCarriage = this.toggleVisibleCarriage.bind(this);

        this.canvasHeight = Math.min(Math.max(this.config.getNode("Plotter.maxHeight"),
                Plotter.windowHeight), Plotter.canvasMaxHeight);

        // Create the Plotter window
        let geometry = this.config.formatWindowGeometry("Plotter");
        this.persistentWindowPosition = (geometry.length > 0);
        if (this.persistentWindowPosition) {
            [this.innerWidth, this.innerHeight, this.windowLeft, this.windowTop] =
                    this.config.getWindowGeometry("Plotter");
            this.viewScaleFactor =
                    Math.floor((this.innerWidth - Plotter.windowExtraWidth)/Plotter.canvasMaxWidth*1000)/1000;
        } else {
            this.viewScaleFactor = (this.config.getNode("Plotter.scale") == 2 ? 1.0 : 0.5);
            this.innerHeight = Plotter.windowHeight;
            this.innerWidth = Plotter.windowExtraWidth +
                    Math.round(Plotter.canvasMaxWidth*this.viewScaleFactor);
            this.windowLeft = 8 /***Math.round((screen.availWidth - this.innerWidth)/2)***/;
            this.windowTop = screen.availHeight - Plotter.windowHeight;
            geometry = `,left=${this.windowLeft},top=${this.windowTop}` +
                       `,innerWidth=${this.innerWidth},innerHeight=${Plotter.windowHeight}`;
        }

        openPopup(window, "../webUI/Plotter.html", "retro-g15.Plotter",
                "location=no,scrollbars,resizable" + geometry,
                this, this.plotterOnLoad);
    }

    /**************************************/
    $$(id) {
        /* Returns a DOM element from its id property. Must not be called until
        plotterOnLoad is called */

        return this.doc.getElementById(id);
    }

    /**************************************/
    plotterOnLoad(ev) {
        /* Initializes the Plotter window and user interface. Creates many
        additional global properties */
        const prefs = this.config.getNode("Plotter");

        this.doc = ev.target;           // now we can use this.$$()
        this.doc.title = "retro-g15 Plotter";
        this.window = this.doc.defaultView;

        this.hCoord = this.$$("HCoordSpan");
        this.vCoord = this.$$("VCoordSpan");
        this.carriage = this.$$("Carriage");
        this.penCursor = this.$$("PenCursor");
        this.penUpLamp = this.$$("PenUpLamp");
        this.penDownLamp = this.$$("PenDownLamp");
        this.scaleFactorSpan = this.$$("ScaleFactor");

        this.frame = this.$$("PlotterFrame");
        this.frameWin = this.frame.contentWindow;
        this.frameDoc = this.frame.contentDocument;
        this.frameBody = this.frameDoc.getElementById("FrameBody");
        this.canvasDiv = this.frameDoc.getElementById("CanvasDiv");
        this.canvas = this.frameDoc.getElementById("PlotterCanvas");
        this.dc = this.canvas.getContext("2d", {alpha: false, willReadFrequently: false});

        this.printingFrame = this.$$("PrintingFrame");
        this.printingFrameDoc = this.printingFrame.contentDocument;
        this.printingBody = this.printingFrameDoc.getElementById("FrameBody");
        this.printingCanvasDiv = this.printingFrameDoc.getElementById("CanvasDiv");
        this.printingCanvas = this.printingFrameDoc.getElementById("PlotterCanvas");

        this.calculateScaling();
        this.canvas.height = this.canvasHeight;
        this.canvas.width = Plotter.canvasMaxWidth;
        this.canvas.title = `Max plot area: ${Plotter.canvasMaxWidth} × ${this.canvasHeight} pixels`;

        // Events
        this.window.addEventListener("beforeunload", this.beforeUnload);
        this.window.addEventListener("resize", this.boundResizeWindow);
        this.$$("LineWidthSelect").addEventListener("change", this.boundChangeLineWidth);
        this.$$("ControlsDiv").addEventListener("click", this.boundControlClick);
        this.$$("ControlsDiv").addEventListener("mousedown", this.boundControlMouseDown);
        this.$$("ControlsDiv").addEventListener("mouseup", this.boundControlMouseUp);
        this.$$("PenCaption").addEventListener("dblclick", this.boundToggleVisibleCarriage);
        this.scaleFactorSpan.addEventListener("dblclick", this.boundRestoreWindowGeometry);

        // Recalculate scaling and offsets after initial window resize. The
        // Plotter does this differently because its window is sized to the
        // drawing canvas, rather than the canvas being sized to the window.
        this.restoreWindowGeometry();
        setTimeout(() => {
            this.emptyCanvas();
            this.changeColor("black");          // the default
            this.carriage.style.display = "block";
            this.visibleCarriage = (this.config.getNode("Plotter.visibleCarriage") ? false : true); // negated for toggle, next
            this.toggleVisibleCarriage();
        }, 40);
    }

    /**************************************/
    clear() {
        /* Initializes the plotter unit state */

        this.emptyCanvas();
        this.outputReadyStamp = 0;      // timestamp when ready for output
    }

    /**************************************/
    cancel() {
        /* Cancels the I/O currently in process. This routine does nothing
        useful. It exists only to satisfy the Processor's I/O cancelation
        interface */

        this.busy = false;
    }

    /**************************************/
    beforeUnload(ev) {
        /* Handles the beforeunload event to warn the user that closing the
        window is not a good idea */
        const msg = "Closing this window will make the device unusable.\n" +
                    "Suggest you stay on the page and minimize this window instead";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    controlClick(ev) {
        /* Handles click events for the controls pane */

        switch (ev.target.id) {
        case "StepLeftBtn":
            this.move(-1, 0);
            break;
        case "StepRightBtn":
            this.move(1, 0);
            break;
        case "StepUpBtn":
            this.move(0, 1);
            break;
        case "StepDownBtn":
            this.move(0, -1);
            break;
        case "PenUpBtn":
            this.raisePen();
            break;
        case "PenDownBtn":
            this.lowerPen();
            break;
        case "PrintBtn":
            this.printCanvas(ev);
            break;
        case "SaveBtn":
            this.saveCanvas(ev);
            break;
        case "HomeBtn":
            this.homeCursor();
            break;
        case "ClearBtn":
            if (this.window.confirm("Are you sure you want to erase the drawing?")) {
                this.emptyCanvas();
            }
            break;
        case "BlackBtn":
            this.changeColor("black");
            break;
        case "RedBtn":
            this.changeColor("red");
            break;
        case "GreenBtn":
            this.changeColor("green");
            break;
        case "BlueBtn":
            this.changeColor("blue");
            break;
        case "BrownBtn":
            this.changeColor("#630");
            break;
        }
    }

    /**************************************/
    controlMouseDown(ev) {
        /* Handles mousedown events for the controls pane */

        switch (ev.target.id) {
        case "FastLeftBtn":
            this.moveFast(-1, 0);
            break;
        case "FastRightBtn":
            this.moveFast(1, 0);
            break;
        case "FastUpBtn":
            this.moveFast(0, 1);
            break;
        case "FastDownBtn":
            this.moveFast(0, -1);
            break;
        }
    }
    /**************************************/
    controlMouseUp(ev) {
        /* Handles mouseup events for the controls pane */

        switch (ev.target.id) {
        case "FastLeftBtn":
        case "FastRightBtn":
        case "FastUpBtn":
        case "FastDownBtn":
            this.movingFast = false;
            break;
        }
    }

    /**************************************/
    calculateScaling() {
        /* Calculates the canvas scaling and scrolling factors initially and
        whenever the window is resized */

        this.viewHeight = this.frameBody.offsetHeight;
        this.viewWidth = this.canvasDiv.offsetWidth;
        this.viewScaleFactor = this.viewWidth/Plotter.canvasMaxWidth;
        this.scaleFactorSpan.textContent = this.viewScaleFactor.toFixed(3);

        this.vCursorOffset = Math.round(this.viewHeight/2);
        this.vCursorTop = Math.round(this.viewHeight*Plotter.vCursorTopFactor);
        this.vCursorBottom = Math.round(this.viewHeight*Plotter.vCursorBottomFactor);

        this.viewScrollOffset = Math.round(this.frameWin.pageYOffset);
        this.viewScrollMax = this.canvas.scrollHeight - this.viewHeight;
        this.viewScrollLimit = this.viewScrollMax + this.vCursorBottom;
    }

    /**************************************/
    resizeWindow() {
        /* Handles Plotter window resize events and sizing of the canvas during
        initialization */

        this.calculateScaling();                // recomputes cursor offset, scroll limits
        this.carriage.style.top = `${this.vCursorOffset}px`;
        this.positionCursor(this.stepXLast, this.stepYLast, true);      // force the reposition

        //const pointOffset = Math.round(this.stepYLast*this.viewScaleFactor) -
        //        this.viewScrollOffset + this.viewSlideOffset;
        //if (this.vCursorOffset != pointOffset) {
        //    console.debug("Plotter Resize cy=%5i sy=%5i PO=%4i VCO=%4i VSO=%5i VSM=%5i VLO=%4i",
        //            this.stepYLast, Math.round(this.stepYLast*this.viewScaleFactor), pointOffset,
        //            this.vCursorOffset, this.viewScrollOffset, this.viewScrollMax, this.viewSlideOffset);
        //}
    }

    /**************************************/
    restoreWindowGeometry() {
        /* Resize the window to its configured size, taking into account the
        difference between inner and outer heights (WebKit quirk). Also force
        the width to match the initial scale factor */
        const dh = this.innerHeight - this.window.innerHeight;

        if (this.persistentWindowPosition) {
            const dw = this.innerWidth - this.window.innerWidth;
            this.viewScaleFactor = Math.floor((this.canvasDiv.offsetWidth + dw)/Plotter.canvasMaxWidth*1000)/1000;
            this.window.resizeBy(dw, dh);
        } else {
            const dw = Plotter.canvasMaxWidth/Math.round(1/this.viewScaleFactor) - this.canvasDiv.offsetWidth;
            this.viewScaleFactor = (this.config.getNode("Plotter.scale") == 2 ? 1.0 : 0.5);
            this.window.resizeBy(dw, dh);
        }

        setTimeout(() => {
            this.window.moveTo(this.windowLeft, this.windowTop);
            this.resizeWindow();
        }, 20);
    }

    /**************************************/
    printCanvas(ev) {
        /* Handler for clicking the Print button and printing the plotting area.
        Clones the visible canvas and inserts it into the (hidden) <iframe>
        behind the visible <iframe>, then initiates the print dialog for that
        (hidden) <iframe> */

        if (this.printingCanvas) {      // remove any old canvas from its frame
            this.printingCanvasDiv.removeChild(this.printingCanvas);
        }

        this.printingCanvas = this.cloneCanvas(0);
        this.printingCanvas.id = "PlotterCanvas";
        this.printingCanvasDiv.appendChild(this.printingCanvas);
        this.printingCanvasDiv.style.left = "50%";
        this.printingCanvasDiv.style.width = "fit-content";
        this.printingCanvasDiv.style.height = "fit-content";
        this.printingCanvasDiv.style.transform = "translate(-50%,0)";
        this.printingCanvas.style.position = "static";
        this.printingCanvas.style.width = "revert";
        this.printingFrame.contentWindow.print();
    }

    /**************************************/
    saveCanvas(ev) {
        /* Handler for clicking the Save button and converting the canvas to
        a PNG image */
        const canvas = this.cloneCanvas(1);
        const data = canvas.toDataURL("image/png");
        const hiddenLink = this.doc.createElement("a");

        hiddenLink.setAttribute("download", "PlotterImage.png");
        hiddenLink.setAttribute("href", data);
        hiddenLink.click();
    }


    /*******************************************************************
    *  Plotter Output                                                  *
    *******************************************************************/

    /**************************************/
    toInternalCoord(cx, cy) {
        /* Converts canvas pixel coordinates to internal pixel coordinates */

        return [cx, cy-Plotter.canvasVOffset];
    }

    /**************************************/
    toCanvasCoord(x, y) {
        /* Converts internal pixel coordinates to canvas pixel coordinates */

        return [x, y+Plotter.canvasVOffset];
    }

    /**************************************/
    homeCursor() {
        /* Homes the cursor and resets the related properties */

        this.x = this.y = 0;
        const [cx, cy] = this.toCanvasCoord(this.x, this.y);
        this.viewScrollOffset = 0;
        this.viewSlideOffset = this.vCursorOffset;
        this.cxLast = this.stepXLast = cx;
        this.cyLast = this.stepYLast = cy;
        this.raisePen();
        this.frameWin.scrollTo(0, 0)
        this.frame.style.top = `${this.viewSlideOffset}px`;
        this.carriage.style.top = `${this.vCursorOffset}px`;
        this.penCursor.style.left = `${cx}px`;
        this.positionCursor(cx, cy, true);      // force the re-position to happen
    }

    /**************************************/
    emptyCanvas() {
        /* Erases the plotter canvas, initializes it for new output, and resets
        the vertical origin to the middle of the plotting area */

        this.xMax = this.yMax = 0;
        this.xMin = this.canvasHeight;
        this.yMin = Plotter.canvasMaxWidth;
        this.raisePen();
        this.homeCursor();

        const saveStyle = this.dc.fillStyle;
        this.dc.fillStyle = "white";
        this.dc.fillRect(0, 0, Plotter.canvasMaxWidth+1, this.canvasHeight+1);
        this.dc.fillStyle = saveStyle;
        if (this.printingCanvas) {      // remove any print canvas from its frame
            this.printingCanvasDiv.removeChild(this.printingCanvas);
            this.printingCanvas = null;
        }
    }

    /**************************************/
    changeLineWidth() {
        /* Changes the canvas drawing line with to the current LineWidthSelect
        option setting */
        const sel = this.$$("LineWidthSelect");
        const opt = sel.options[sel.selectedIndex || 0];

        if (opt) {
            this.canvasLineWidth = parseInt(opt.value, 10) || 1;
            this.canvasLineOffset = -Math.floor(this.canvasLineWidth/2);
        }
    }

    /**************************************/
    changeColor(color) {
        /* Changes the pen color */
        const lamps = this.$$("PaletteDiv").querySelectorAll(".panelLamp");

        for (const lamp of lamps) {     // reset all of the color-selection lamps
            lamp.style.display = "none";
        }

        // Set the pen color and the corresponding lamp.
        this.dc.fillStyle = color;
        switch (color) {
        case "black":
            this.$$("BlackLamp").style.display = "block";
            break;
        case "red":
            this.$$("RedLamp").style.display = "block";
            break;
        case "green":
            this.$$("GreenLamp").style.display = "block";
            break;
        case "blue":
            this.$$("BlueLamp").style.display = "block";
            break;
        case "#630":
            this.$$("BrownLamp").style.display = "block";
            break;
        }
    }

    /**************************************/
    cloneCanvas(margin) {
        /* Copies that part of the visible canvas from (xMin,yMin) to (xMax,yMax)
        and returns that portion as a new canvas object. "margin" specifies the
        number of margin pixels to be added around the original canvas */
        const margin2 = margin*2;
        const [cxMin, cyMin] = this.toCanvasCoord(this.xMin, this.yMin);
        const [cxMax, cyMax] = this.toCanvasCoord(this.xMax, this.yMax);
        const width = cxMax-cxMin+2;
        const height = cyMax-cyMin+2;
        const iData = this.dc.getImageData(cxMin, cyMin, width, height);

        const newCanvas = this.doc.createElement("canvas");
        newCanvas.width = width+margin2;
        newCanvas.height = height+margin2;
        const newDC = newCanvas.getContext("2d");
        newDC.fillStyle = "white";
        newDC.clearRect(0, 0, width+margin2, height+margin2);
        newDC.putImageData(iData, margin, margin);
        return newCanvas;
    }

    /**************************************/
    toggleVisibleCarriage() {
        /* Toggles the visibility of the pen carriage, but leaves the pen
        reticle visible */

        this.visibleCarriage = !this.visibleCarriage;
        const display = (this.visibleCarriage ? "block" : "none");
        this.$$("CarriageUpperRail").style.display = display;
        this.$$("CarriageUpperGuide").style.display = display;
        this.$$("CarriageLowerRail").style.display = display;
        this.$$("CarriageLowerGuide").style.display = display;
        this.config.putNode("Plotter.visibleCarriage", (this.visibleCarriage ? 1 : 0));
    }

    /**************************************/
    positionCursor(cx, cy, force=false) {
        /* Positions the cursor crosshairs to the specified canvas pixel
        coordinates. If the current point is between the upper and lower
        scrolling boundaries, moves the pen carriage; if the point is above the
        top boundary or below the bottom scrolling limit, slides teh canvas up
        or down; otherwise scrolls the window. If "force" is truthy, the cursor
        will be positioned even if its coordinates have not changed (used when
        resizing the window or homing the cursor) */
        const vx = Math.round(cx*this.viewScaleFactor);
        const vy = Math.round(cy*this.viewScaleFactor);
        const yLast = Math.round(this.cyLast*this.viewScaleFactor);

        this.hCoord.textContent = this.y;
        this.vCoord.textContent = this.x;
        if (this.cxLast != cx || force) {
            this.penCursor.style.left = `${vx}px`;
            this.cxLast = cx;
        }

        if (vy != yLast || force) {
            if (vy < this.vCursorTop) {
                // New point is above the than the top boundary, slide the canvas down.
                this.viewSlideOffset = this.vCursorTop - vy;
                if (this.viewScrollOffset > 0) {
                    this.viewScrollOffset = 0;
                    this.frameWin.scrollTo(0, this.viewScrollOffset);
                }

                this.frame.style.top = `${this.viewSlideOffset}px`;
            } else if (vy > this.viewScrollLimit) {
                // New point is below the scroll limit, slide the canvas up.
                this.viewSlideOffset = this.viewScrollLimit - vy;
                if (this.viewScrollOffset < this.viewScrollMax) {
                    this.viewScrollOffset = this.viewScrollMax;
                    this.frameWin.scrollTo(0, this.viewScrollOffset);
                }

                this.frame.style.top = `${this.viewSlideOffset}px`;
            } else {
                // Remove any sliding before doing any scrolling.
                if (this.viewSlideOffset != 0) {
                    this.viewSlideOffset = 0;
                    this.frame.style.top = "0";
                }

                const newOffset = vy - this.viewScrollOffset;
                if (newOffset > this.vCursorBottom) {
                    // New point is below the bottom boundary, so increase scroll offset (scroll up).
                    this.viewScrollOffset = vy - this.vCursorOffset;
                    this.frameWin.scrollTo(0, this.viewScrollOffset);
                } else if (newOffset > this.vCursorTop) {
                    // New point is between the boundaries, so move the carriage.
                    this.vCursorOffset = newOffset;
                    this.carriage.style.top = `${newOffset}px`;
                } else {
                    // New point is above the top boundary, so decrease scroll offset (scroll down).
                    this.viewScrollOffset = vy - this.vCursorOffset;
                    this.frameWin.scrollTo(0, this.viewScrollOffset);
                }

                this.cyLast = cy;
            }
        }
    }

    /**************************************/
    async raisePen() {
        /* Sets the pen in the up position */
        const now = performance.now();
        const delay = this.outputReadyStamp - now;

        this.penDown = false;
        this.penCursor.classList.remove("penDown");
        this.penDownLamp.style.display = "none";
        this.penUpLamp.style.display = "block";
        if (delay < 0) {
            this.outputReadyStamp = now + Plotter.penPeriod*Util.timingFactor;
        } else {
            this.outputReadyStamp += Plotter.penPeriod*Util.timingFactor;
            if (delay > Plotter.minWait) {
                return this.timer.set(delay);
            }
        }

        return;
    }

    /**************************************/
    async lowerPen() {
        /* Sets the pen in the down position */
        const now = performance.now();
        const delay = this.outputReadyStamp - now;

        this.penDown = true;
        this.penCursor.classList.add("penDown");
        this.penUpLamp.style.display = "none";
        this.penDownLamp.style.display = "block";
        if (delay < 0) {
            this.outputReadyStamp = now + Plotter.penPeriod*Util.timingFactor;
        } else {
            this.outputReadyStamp += Plotter.penPeriod*Util.timingFactor;
            if (delay > Plotter.minWait) {
                return this.timer.set(delay);
            }
        }

        return;
    }

    /**************************************/
    drawSteps(timestamp) {
        /* Called by the requestAnimationFrame mechanism to draw any plotter
        steps accumulated in this.stepCache. If there has been only pen-up
        movement since the last frame, then the cache will be empty, so all
        that we need to do is reposition the cursor */
        const top = this.stepCacheTop;

        // Draw the cached step movements on the drawing canvas.
        if (top) {
            const cache = this.stepCache;
            for (let x=0; x<top; x+=2) {
                this.dc.fillRect(cache[x]+this.canvasLineOffset, cache[x+1]+this.canvasLineOffset,
                        this.canvasLineWidth, this.canvasLineWidth);
            }

            this.stepCacheTop = 0;
        }

        this.stepCacheToken = 0;
        this.positionCursor(this.stepXLast, this.stepYLast);

        // Update average frames/second (debug only).
        // const elapsed = timestamp - this.frameLastStamp;                                // frame time, ms
        // this.frameLastStamp = timestamp;
        // this.fps = this.fps*(1-Plotter.fpsAlpha) + Plotter.fpsAlpha*1000/elapsed;       // avg frame/sec
        // this.$$("FPS").textContent = this.fps.toFixed(2);
    }

    /**************************************/
    move(dx, dy) {
        /* Steps the plot in the indicated direction(s). Caches all movement
        until the next animation frame time, when it will then be drawn. If the
        pen is down, caches the coordinates of a new point to be drawn;
        otherwise just caches the last pen position. Throttles I/O timing to
        the actual speed of the plotter after each animation frame event.
        Returns a Promise that resolves once a new command can be accepted */
        const now = performance.now();

        let x = this.x;
        let y = this.y;
        const [cx, cy] = this.toCanvasCoord(x, y);

        // Cache this step until the next frame time.
        this.stepXLast = cx;
        this.stepYLast = cy;
        if (this.penDown) {
            if (this.stepCacheTop) {
                if (this.stepCache.length <= this.stepCacheTop) {
                    this.stepCache.push(cx, cy);
                } else {
                    this.stepCache[this.stepCacheTop] = cx;
                    this.stepCache[this.stepCacheTop+1] = cy;
                }

                this.stepCacheTop += 2;
            } else {
                this.stepCache[0] = cx;
                this.stepCache[1] = cy;
                this.stepCacheTop = 2;
            }
        }

        // Determine new (x,y) from (dx,dy) and update overall extents of the plot.
        x += dx;
        if (x < 0) {
            x = 0;
        } else if (x >= Plotter.canvasMaxWidth) {
            x = Plotter.canvasMaxWidth-1;
        } else if (this.penDown) {
            if (x > this.xMax) {this.xMax = x}
            if (x < this.xMin) {this.xMin = x}
        }

        y += dy;
        if (y < 0) {
            y = 0;
        } else if (y >= this.canvasHeight) {
            y = this.canvasHeight-1;
        } else if (this.penDown) {
            if (y > this.yMax) {this.yMax = y}
            if (y < this.yMin) {this.yMin = y}
        }

        this.x = x;
        this.y = y;

        // this.stepCacheToken will be zero if this is the first call after an
        // animation frame event occurred; schedule the next frame update and
        // throttle for any accumulated delay.
        if (!this.stepCacheToken) {
            this.stepCacheToken = this.window.requestAnimationFrame(this.boundDrawSteps);
        }

        const delay = this.outputReadyStamp - now;
        if (delay < 0) {
            this.outputReadyStamp = now + Plotter.stepPeriod*Util.timingFactor;
        } else {
            this.outputReadyStamp += Plotter.stepPeriod*Util.timingFactor;
            if (delay > Plotter.minWait) {
                return this.timer.set(delay);
            }
        }

        return Promise.resolve();
    }

    /**************************************/
    async moveFast(dx, dy) {
        /* Initiates and terminates fast manual movement of the cursor */

        this.movingFast = true;
        do {
            await this.move(dx, dy);
        } while (this.movingFast);
    }

    /**************************************/
    write(code) {
        /* Decodes one plotter command. The plotter can respond to the following
        command codes:
            0: Pen down
            1: +Y
            2: +X +Y
            3: +X
            4: +X -Y
            5: -Y
            6: -X -Y
            7: -X
            8: -X +Y
            9: Pen up
        At present, the G-15 can only issue commands for +X, -Y, +Y, -Y,
        Pen down, and Pen up, so codes 2, 4, 6, and 8 are not used.
        Returns a Promise that resolves once any pending delay has taken place */

        switch (code) {
        case 0:                         // Pen down
            //console.debug(`Plotter: ${code} lower pen`);
            return this.lowerPen();
            break;
        case 1:                         // +Y Move left (right in the window)
            //console.debug(`Plotter: ${code} +Y`);
            return this.move(1, 0);
            break;
        case 3:                         // +X Move up (down in the window)
            //console.debug(`Plotter: ${code} +X`);
            return this.move(0, 1);
            break;
        case 5:                         // -Y Move right (left in the window)
            //console.debug(`Plotter: ${code} -Y`);
            return this.move(-1, 0);
            break;
        case 7:                         // -X Move down (up in the window)
            //console.debug(`Plotter: ${code} -X`);
            return this.move(0, -1);
            break;
        case 9:                         // Pen up
            //console.debug(`Plotter: ${code} raise pen`);
            return this.raisePen();
            break;
        case -1:
            // Experimental feature to programmatically clear the plot. Not documented //
            //console.debug(`Plotter: ${code} clear plot`);
            this.emptyCanvas();
            return Promise.resolve();
            break;
        default:                        // no action
            //console.debug(`Plotter: ${code} NO-OP`);
            return Promise.resolve();
            break;
        }
    }

    /**************************************/
    shutDown() {
        /* Shuts down the device. If the window open failed and onLoad didn't
        run, do nothing because this.window, etc., didn't get initialized */

        if (this.stepCacheToken) {
            this.window.cancelAnimationFrame(this.stepCacheToken);
            this.stepCacheToken = 0;
        }

        if (this.window) {
            this.$$("LineWidthSelect").removeEventListener("change", this.boundChangeLineWidth);
            this.$$("ControlsDiv").removeEventListener("click", this.boundControlClick);
            this.$$("ControlsDiv").removeEventListener("mousedown", this.boundControlMouseDown);
            this.$$("ControlsDiv").removeEventListener("mouseup", this.boundControlMouseUp);
            this.$$("PenCaption").removeEventListener("dblclick", this.boundToggleVisibleCarriage);
            this.scaleFactorSpan.removeEventListener("dblclick", this.boundRestoreWindowGeometry);

            this.config.putWindowGeometry(this.window, "Plotter");
            this.window.removeEventListener("resize", this.boundResizeWindow);
            this.window.removeEventListener("beforeunload", this.beforeUnload);
            this.window.close();
        }
    }

} // class Plotter
