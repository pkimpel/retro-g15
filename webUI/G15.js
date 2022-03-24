/***********************************************************************
* retro-g15/webUI G15.js
************************************************************************
* Copyright (c) 2021, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 Emulator top page routines.
************************************************************************
* 2021-11-30  P.Kimpel
*   Original version, from retro-205 D205.js.
***********************************************************************/

import {ControlPanel} from "./ControlPanel.js";
import {DiagPanel} from "./DiagPanel.js";
import {Processor} from "../emulator/Processor.js";

import {PhotoTapeReader} from "./PhotoTapeReader.js";
import {PhotoTapePunch} from "./PhotoTapePunch.js";

let globalLoad = (ev) => {
    //let config = new G15SystemConfig(); // system configuration object
    let diagPanel = null;               // handle for the diagnostic panel
    let statusMsgTimer = 0;             // status message timer control cookie

    const context = {
        $$,
        closeDiagPanel,
        systemShutDown,
        window
    };


    /**************************************/
    function $$(id) {
        return document.getElementById(id);
    }

    /**************************************/
    function showConfigName() {
        /* Displays the name of the current system configuration */

        $$("ConfigName").textContent = config.getConfigName();
    }

    /**************************************/
    function beforeUnload(ev) {
        var msg = "Closing this window will terminate the emulator";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    function systemShutDown() {
        /* Powers down the Processor and shuts down all of the panels and I/O devices */
        let devices = context.devices;
        let processor = context.processor;

        processor.stop();
        for (const e in devices) {
            if (devices[e]) {
                devices[e].shutDown();
                devices[e] = null;
            }
        }

        closeDiagPanel();
        context.controlPanel.shutDown();
        context.controlPanel = null;

        processor.powerDown();
        context.devices = null;
        context.processor = null;

        $$("G15Logo").removeEventListener("dblclick", openDiagPanel, false);
        $$("FrontPanel").style.display = "none";
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").focus();
        window.removeEventListener("beforeunload", beforeUnload);
        //$$("ConfigureBtn").disabled = false;
        //config.flush();
    }

    /**************************************/
    function systemStartup(ev) {
        /* Establishes the system components */

        ev.target.disabled = true;
        $$("StartUpBtn").disabled = true;
        //$$("ConfigureBtn").disabled = true;

        window.addEventListener("beforeunload", beforeUnload);
        $$("FrontPanel").style.display = "block";       // must be done before panel is built
        $$("G15Logo").addEventListener("dblclick", openDiagPanel, false);

        context.processor = new Processor(context);
        context.controlPanel = new ControlPanel(context);
        context.devices = {
            "photoTapeReader":          new PhotoTapeReader(context),
            "photoTapePunch":           new PhotoTapePunch(context)
        }

        context.devices.photoTapeReader.preload();      // preload the PPR image
        context.processor.powerUp();
    }

    /**************************************/
    function configureSystem(ev) {
        /* Opens the system configuration UI */

        config.openConfigUI(showConfigName);
    }

    /**************************************/
    function clearStatusMsg(inSeconds) {
        /* Delays for "inSeconds" seconds, then clears the StatusMsg element */

        if (statusMsgTimer) {
            clearTimeout(statusMsgTimer);
        }

        statusMsgTimer = setTimeout(function(ev) {
            $$("StatusMsg").textContent = "";
            statusMsgTimer = 0;
        }, inSeconds*1000);
    }

    /**************************************/
    function openDiagPanel(ev) {
        /* Opens the emulator's diagnostic panel in a new sub-window */

        if (!diagPanel) {
            diagPanel = new DiagPanel(context);
        }
    }

    /**************************************/
    function closeDiagPanel() {
        /* Closes the emulator's diagnostic panel */

        if (diagPanel) {
            if (!diagPanel.closed) {
                diagPanel.shutDown();
            }

            diagPanel = null;
        }
    }

    /**************************************/
    function checkBrowser() {
        /* Checks whether this browser can support the necessary stuff */
        let missing = "";

        if (!window.ArrayBuffer) {missing += ", ArrayBuffer"}
        if (!window.DataView) {missing += ", DataView"}
        if (!window.Blob) {missing += ", Blob"}
        if (!window.File) {missing += ", File"}
        if (!window.FileReader) {missing += ", FileReader"}
        if (!window.FileList) {missing += ", FileList"}
        if (!window.JSON) {missing += ", JSON"}
        if (!window.localStorage) {missing += ", LocalStorage"}
        if (!window.indexedDB) {missing += ", IndexedDB"}
        if (!window.postMessage) {missing += ", window.postMessage"}
        if (!(window.performance && "now" in performance)) {missing += ", performance.now"}
        if (!window.Promise) {missing += ", Promise"}

        if (missing.length == 0) {
            return true;
        } else {
            alert("The emulator cannot run...\n" +
                "your browser does not support the following features:\n\n" +
                missing.substring(2));
            return false;
        }
    }

    /***** window.onload() outer block *****/

    window.removeEventListener("load", globalLoad, false);
    $$("StartUpBtn").disabled = true;
    //$$("EmulatorVersion").textContent = Processor.version;
    if (checkBrowser()) {
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").addEventListener("click", systemStartup, false);
        $$("StartUpBtn").focus();
        //$$("ConfigureBtn").disabled = false;
        //$$("ConfigureBtn").addEventListener("click", configureSystem, false);

        //$$("StatusMsg").textContent = "??";
        //clearStatusMsg(30);
    }
} // globalLoad

window.addEventListener("load", globalLoad, false);
