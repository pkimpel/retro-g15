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
import {Processor} from "../emulator/Processor.js";

window.addEventListener("load", function() {
    //let config = new G15SystemConfig(); // system configuration object
    let controlPanel = null;            // controlPanel object
    let devices = {};                   // hash of I/O devices for the Processor
    //let diagWindow = null;              // handle for the diagnostic monitor panel
    let processor = null;               // the Processor object
    let statusMsgTimer = 0;             // status message timer control cookie

    const context = {                   // passed to ControlPanel constructor
        $$,
        systemShutDown
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
    function systemShutDown() {
        /* Powers down the Processor and shuts down all of the panels and I/O devices */

        /**************************************
        processor.powerDown();
        for (const e in devices) {
            if (devices[e]) {
                devices[e].shutDown();
                devices[e] = null;
            }
        }

        if (diagWindow && !diagWindow.closed) {
            diagWindow.close();
        }

        processor = null;
        ************************************/

        controlPanel.close();
        controlPanel = null;
        $$("FrontPanel").style.display = "none";
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").focus();
        //$$("ConfigureBtn").disabled = false;

        //config.flush();
    }

    /**************************************/
    function systemStartup(ev) {
        /* Establishes the system components */
        let u;
        let x;

        ev.target.disabled = true;
        $$("StartUpBtn").disabled = true;

        //$$("ConfigureBtn").disabled = true;

        processor = new Processor();
        //devices.ControlConsole = new G15ControlConsole(processor);

        $$("FrontPanel").style.display = "block";       // must be done before panel is built
        controlPanel = new ControlPanel(context);
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
        /* Opens the emulator's diagnostic monitor panel in a new sub-window */
        let global = window;

        G15Util.openPopup(window, "G15DiagMonitor.html", "DiagPanel",
                "resizable,width=300,height=500,left=0,top=" + screen.availHeight-500,
                this, function(ev) {
            diagWindow = ev.target.defaultView;
            diagWindow.global = global; // give it access to our globals.
            diagWindow.focus();
        });
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

    $$("StartUpBtn").disabled = true;
    //$$("EmulatorVersion").textContent = G15Processor.version;
    if (checkBrowser()) {
        //showConfigName();
        //$$("RetroG15Logo").addEventListener("dblclick", openDiagPanel, false);
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").addEventListener("click", systemStartup, false);
        $$("StartUpBtn").focus();
        //$$("ConfigureBtn").disabled = false;
        //$$("ConfigureBtn").addEventListener("click", configureSystem, false);

        //$$("StatusMsg").textContent = "??";
        //clearStatusMsg(30);
    }
});
