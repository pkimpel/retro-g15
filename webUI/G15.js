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

import * as Version from "../emulator/Version.js";
import * as Util from "../emulator/Util.js";

import {ControlPanel} from "./ControlPanel.js";
import {DiagPanel} from "./DiagPanel.js";
import {Processor} from "../emulator/Processor.js";

import {PaperTapeReader} from "./PaperTapeReader.js";
import {PaperTapePunch} from "./PaperTapePunch.js";
import {Typewriter} from "./Typewriter.js";
import {Sound} from "./Sound.js";

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
    function beforeUnload(ev) {
        var msg = "Closing this window will terminate the emulator";

        ev.preventDefault();
        ev.returnValue = msg;
        return msg;
    }

    /**************************************/
    function systemStartup(ev) {
        /* Establishes the system components and adjusts peripheral speeds based
        on drum RPM */

        $$("StartUpBtn").disabled = true;
        //$$("ConfigureBtn").disabled = true;

        window.addEventListener("beforeunload", beforeUnload);
        $$("G15Logo").addEventListener("dblclick", openDiagPanel, false);

        context.processor = new Processor(context);
        context.devices = {
            "paperTapeReader":          new PaperTapeReader(context),
            "paperTapePunch":           new PaperTapePunch(context),
            "typewriter":               new Typewriter(context),
            "sound":                    new Sound(context)
        }

        let timingFactor = Util.drumRPM/Util.defaultRPM;
        let readerSpeed = Math.min(PaperTapeReader.defaultSpeed*timingFactor, 2000);
        context.devices.paperTapeReader.setSpeed(readerSpeed)
        context.devices.paperTapeReader.preload();      // preload the PPR image
        context.processor.powerUp();
        context.controlPanel.enablePanel();
    }

    /**************************************/
    function systemShutDown() {
        /* Powers down the Processor and shuts down all of the panels and I/O devices */
        const processor = context.processor;

        if (processor.CH.value == 0 || processor.OC.value & 0b1111) {
            processor.stop();
            if (processor.activeIODevice) {
                if (processor.canceledIO) {
                    processor.finishIO();
                } else {
                    processor.cancelIO();
                }
            }
            setTimeout(systemShutDown, 250);
            return;
        }

        const devices = context.devices;
        for (const e in devices) {
            if (devices[e]) {
                devices[e].shutDown();
                devices[e] = null;
            }
        }

        closeDiagPanel();
        $$("G15Logo").removeEventListener("dblclick", openDiagPanel, false);
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").focus();
        window.removeEventListener("beforeunload", beforeUnload);
        //$$("ConfigureBtn").disabled = false;
        //config.flush();

        if (processor.poweredOn) {
            const systemShutdown = $$("SystemShutdown");
            systemShutdown.volume = 0.25;
            systemShutdown.currentTime = 0;
            systemShutdown.play();
            $$("DCPowerLamp").classList.remove("redLit");
            $$("DCPowerLampFX").classList.add("powerDown");
        }

        setTimeout(() => {       // wait for the DC power supplies...
            $$("DCPowerLampFX").classList.remove("powerDown");
            $$("SystemShutdown").pause();
            context.controlPanel.disablePanel();

            processor.powerDown();
            context.devices = null;
            context.processor = null;
        }, processor.poweredOn ? 3000 : 1000);
    }

    /**************************************/
    function parseQueryString() {
        /* Parses the query string for the request, looking for known key/value
        pairs. If found, applies them to the current configuration options */
        let url = new URL(window.location);

        for (let pair of url.searchParams) {
            let key = (pair[0] || "").trim().toUpperCase();
            let val = (pair[1] || "").trim().toUpperCase();

            switch (key) {
            case "RPM":
                val = parseInt(val, 10);
                if (val && val > Util.defaultRPM) {
                    Util.setTiming(val);
                }
                break;
            } // switch key
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

    /***** globalLoad() outer block *****/

    $$("StartUpBtn").disabled = true;
    $$("EmulatorVersion").textContent = Version.g15Version;
    if (checkBrowser()) {
        parseQueryString();
        context.controlPanel = new ControlPanel(context);
        $$("StartUpBtn").disabled = false;
        $$("StartUpBtn").addEventListener("click", systemStartup, false);
        $$("StartUpBtn").focus();
        //$$("ConfigureBtn").disabled = false;
        //$$("ConfigureBtn").addEventListener("click", configureSystem, false);

        //$$("StatusMsg").textContent = "??";
        //clearStatusMsg(30);
    }
}; // globalLoad

window.addEventListener("load", globalLoad, {once: true});
