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

import {PanelRegister} from "./PanelRegister.js";
import {NeonLamp} from "./NeonLamp.js";

window.addEventListener("load", function() {
    //let config = new G15SystemConfig(); // system configuration object
    let devices = {};                   // hash of I/O devices for the Processor
    //var diagWindow = null;              // handle for the diagnostic monitor panel
    let processor = null;               // the Processor object
    let regCharacteristic = null;       // control panel Characteristic register
    let regSource = null;               // control panel Source register
    let regDest = null;                 // control panel Destination register
    let regIO = null;                   // control panel Input/Output register
    let regCmdLine = null;              // control panel Command Line register
    let lampOverflow = null;            // control panel Overflow lamp
    let lampGoDA = null;                // control panel GO-DA lamp
    let lampHalt = null;                // control panel HALT lamp
    let lampDBPR = null;                // control panel double-precision lamp
    let lampPSign = null;               // control panel PN-register sign lamp
    let lampNCAR = null;                // control panel NC-AR lamp
    let lampTest = null;                // control panel TEST lamp
    let lampAS = null;                  // control panel Auto/Standard lamp
    let statusMsgTimer = 0;             // status message timer control cookie

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

        $$("FrontPanel").style.display = "none";
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").focus();
        //$$("ConfigureBtn").disabled = false;

        //config.flush();
    }

    /**************************************/
    function systemStartup(ev) {
        /* Establishes the system components */
        var u;
        var x;

        ev.target.disabled = true;
        $$("StartUpBtn").disabled = true;

        //$$("ConfigureBtn").disabled = true;

        //processor = new G15Processor(config, devices);
        //devices.ControlConsole = new G15ControlConsole(processor);

        $$("FrontPanel").style.display = "block";       // must be done before panel is built
        buildControlPanel();
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
        var global = window;

        G15Util.openPopup(window, "G15DiagMonitor.html", "DiagPanel",
                "resizable,width=300,height=500,left=0,top=" + screen.availHeight-500,
                this, function(ev) {
            diagWindow = ev.target.defaultView;
            diagWindow.global = global; // give it access to our globals.
            diagWindow.focus();
        });
    }

    /**************************************/
    function buildControlPanel() {
        /* Constructs the G15 control panel controls and wires up their events */
        let controlPanel = $$("ControlPanel");
        let panelCenter = controlPanel.clientWidth / 2;

        regCharacteristic = new PanelRegister($$("CharacteristicReg"), 2, 1, "CharacteristicReg_", "CHARACTERISTIC");
        regCharacteristic.lamps[0].element.style.left =
                (regCharacteristic.lamps[0].element.offsetLeft + 20).toString() + "px";

        regSource = new PanelRegister($$("SourceReg"), 5, 1, "SourceReg_", "SOURCE");
        regSource.lamps[0].setCaption("1", true);
        regSource.lamps[1].setCaption("2", true);
        regSource.lamps[2].setCaption("4", true);
        regSource.lamps[3].setCaption("8", true);
        regSource.lamps[4].setCaption("16", true);

        lampOverflow = new NeonLamp(controlPanel, panelCenter+132, 36, "OverflowLamp");
        lampOverflow.setCaption("O'FLO", false);
        lampGoDA = new NeonLamp(controlPanel, panelCenter+132+PanelRegister.hSpacing, 36, "GoDALamp");
        lampGoDA.setCaption("GO", false);
        lampGoDA.setCaption("D.A.", true);
        lampHalt = new NeonLamp(controlPanel, panelCenter+132+PanelRegister.hSpacing*2, 36, "HaltLamp");
        lampHalt.setCaption("HALT", false);

        regCmdLine = new PanelRegister($$("CmdLineReg"), 3, 1, "CmdLineReg_", "COMMAND LINE");

        regDest = new PanelRegister($$("DestReg"), 5, 1, "DestReg_", "DESTINATION");
        regDest.lamps[0].setCaption("1", true);
        regDest.lamps[1].setCaption("2", true);
        regDest.lamps[2].setCaption("4", true);
        regDest.lamps[3].setCaption("8", true);
        regDest.lamps[4].setCaption("16", true);

        lampDBPR = new NeonLamp(controlPanel, panelCenter+142, 104, "DBPRLamp");
        lampDBPR.setCaption("DB-PR", false);
        lampPSign = new NeonLamp(controlPanel, panelCenter+122+PanelRegister.hSpacing*2, 104, "PSignLamp");
        lampPSign.setCaption("P - SIGN", false);

        lampNCAR = new NeonLamp(controlPanel, panelCenter-248+PanelRegister.hOffset+PanelRegister.hSpacing, 172, "NCARLamp");
        lampNCAR.setCaption("NC-AR", false);

        regIO = new PanelRegister($$("IOReg"), 5, 1, "IOReg_", "INPUT-OUTPUT");
        regIO.lamps[0].setCaption("1", true);
        regIO.lamps[1].setCaption("2", true);
        regIO.lamps[2].setCaption("4", true);
        regIO.lamps[3].setCaption("8", true);
        regIO.lamps[4].setCaption("R", true);

        lampTest = new NeonLamp(controlPanel, panelCenter+132+PanelRegister.hSpacing, 172, "TestLamp");
        lampTest.setCaption("TEST", false);

        lampAS = new NeonLamp($$("ASLampDiv"), 4, 4, "ASLamp");
        lampAS.setCaption("AS", true);

    }

    /**************************************/
    function checkBrowser() {
        /* Checks whether this browser can support the necessary stuff */
        var missing = "";

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
