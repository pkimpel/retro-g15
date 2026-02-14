/***********************************************************************
* retro-g15/webUI SystemConfig.js
************************************************************************
* Copyright (c) 2026, Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* Bendix G-15 Emulator System Configuration management object.
*
* Defines the system configuration used internally by the emulator and the
* methods used to manage that configuration data.
*
************************************************************************
* 2026-02-08  P.Kimpel
*   Original version, from retro-1620 webUI/SystemConfig.js.
***********************************************************************/

export {SystemConfig};

import {openPopup} from "./PopupUtil.js";

class SystemConfig {

    // Static Properties

    static configStorageName = "retro-g15-Config";
    static configVersion = 1;
    static flushDelay = 30000;          // flush timer setting, ms

    static defaultConfig = {
        configName: "Default",
        version: SystemConfig.configVersion,
        persistentWindows: 0,
        multiScreen: 0,

        ControlPanel: {
        },

        Typewriter: {
            marginLeft: 0,
            columns: 132,
            tabs: "6,11,16,21,26,31,36,41,46,51,56,61,66,71,76,81,86,91,96,101,106,111,116,121,126"
        },

        Plotter: {
            hasPlotter: 0,
            plotterModel : 0,
            scale: 1,
            maxHeight: 4096,
            visibleCarriage: 1
        },

        WindowConfig: {
            mode: "Auto",
            modes: {
                Auto: {
                    ControlPanel: {
                        screenX: 0,             // dummy initial values
                        screenY: 0,
                        innerWidth: 400,
                        innerHeight: 250
                    }
                }
            }
        }

    };

    constructor() {
        /* Constructor for the SystemConfig configuration management object */

        this.configData = null;         // the configuration properties
        this.configReporter = null;     // callback function passed from main window
        this.flushTimerToken = 0;       // timer token for flushing configuration to localStorage
        this.window = null;             // configuration UI window object
        this.alertWin = window;         // current base window for alert/confirm/prompt

        this.boundFlushHandler = this.flushHandler.bind(this);
        this.boundChangeConfig = this.changeConfig.bind(this);
        this.boundSaveConfigDialog = this.saveConfigDialog.bind(this);
        this.boundCloseConfigUI = this.closeConfigUI.bind(this);
        this.boundWindowClose = (ev) => {this.window.close()};
        this.boundSetDefaultConfig = (ev) => {
                this.createConfigData();
                this.loadConfigDialog();
        };
    }

    /**************************************/
    $$(id) {
        return this.doc.getElementById(id);
    }

    /**************************************/
    async activate() {
        /* Initializes the configuration and determines the window-positioning
        mode. This is async because multi-screen window positioning, if enabled,
        must be requested asynchronously. Returns a message describing the
        window positioning mode */

        // Load or create the system configuration data
        let s = localStorage.getItem(SystemConfig.configStorageName);
        if (!s) {
            this.createConfigData();
        } else {
            this.loadConfigData(s);
        }

        return await this.determineWindowConfigMode();
    }

    /**************************************/
    createConfigData() {
        /* Creates and initializes a new configuration data object and stores it in
        localStorage */

        this.configData = SystemConfig.defaultConfig;
        this.flushHandler();
    }

    /**************************************/
    sortaDeepMerge(destNode, sourceNode) {
        /* Both destNode and sourceNode must be non-null Objects and not
        Functions. Recursively merges into destNode any properties of
        sourceNode missing in destNode. Does not alter any existing elementary
        properties of destNode or its sub-objects. If either parameter is not
        an Object or Array, does nothing. This isn't a complete recursive merge,
        but it's good enough for SystemConfig data */

        for (let key in sourceNode) {
            if (!(key in destNode)) {
                destNode[key] = structuredClone(sourceNode[key]);
            } else {
                let d = destNode[key];
                let s = sourceNode[key];
                if (Array.isArray(s) && Array.isArray(d)) {
                    for (let i=0; i<s.length; ++i) {
                        if (s[i] !== undefined) {
                            if (d[i] === undefined) {
                                d[i] = structuredClone(s[i]);
                            } else {
                                this.sortaDeepMerge(d[i], s[i]);
                            }
                        }
                    }
                } else if (d !== null && typeof d == "object" && !Array.isArray(d) &&
                        Object.isExtensible(d) && !(Object.isSealed(d) || Object.isFrozen(d))) {
                    if (s !== null && typeof s == "object" && !Array.isArray(s)) {
                        this.sortaDeepMerge(d, s);
                    }
                }
            }
        }
    }

    /**************************************/
    loadConfigData(jsonConfig) {
        /* Attempts to parse the JSON configuration data string and store it in
        this.configData. If the parse is unsuccessful, recreates the default
        configuration. Applies any necessary updates to older configurations */

        try {
            this.configData = JSON.parse(jsonConfig);
        } catch (e) {
            this.alertWin.alert("Could not parse system configuration data:\n" +
                  e.message + "\nReinitializing configuration");
            this.createConfigData();
        }

        // Apply structural updates if necessary.
        if (SystemConfig.configVersion != this.configData.version) {
            // Reserved for future use
        }

        // Delete/modify obsolete configuration properties.
            // (RFE)

        // Recursively merge any new properties from the defaults.
        this.sortaDeepMerge(this.configData, SystemConfig.defaultConfig);
    }

    /**************************************/
    async determineWindowConfigMode() {
        /* Attempt to determine the browser's display configuration */
        const cd = this.configData;
        let msg = "";

        if (!cd.persistentWindows) {
            cd.WindowConfig.mode = "Auto";
        } else {
            cd.WindowConfig.mode = "Single";    // default to this if anything below fails
            msg = "-screen persistent";
            if (cd.multiScreen && window.screen.isExtended && ("getScreenDetails" in window)) {
                // Check that permission has not already been denied.
                let permission = null;
                try { // check the newer permission name
                    permission = await navigator.permissions.query({name: "window-management"});
                } catch (e) {
                    try { // fall back to the older permission name
                        permission = await navigator.permissions.query({name: "window-placement"});
                    } catch (e) {
                        msg += ": Multi-screen positioning NOT AVAILABLE";
                    }
                }

                if (permission) {
                    if (permission.state === "denied") {
                        msg += ": Multi-screen positioning DISALLOWED";
                    } else {
                        // Calling getScreenDetails() is what actually triggers the permission.
                        // The result object can be saved globally if needed.
                        try {
                            const screenDetails = await window.getScreenDetails();
                            if (screenDetails !== null) {
                                cd.WindowConfig.mode = "Multiple";
                            }
                        } catch (e) {
                            msg += ": Multi-screen positioning REFUSED";
                        }
                    }
                }
            }
        }

        return `Window positioning is ${cd.WindowConfig.mode}${msg}.`;
    }

    /**************************************/
    flushHandler() {
        /* Callback function for the flush timer. Stores the configuration data */

        this.flushTimerToken = 0;
        localStorage.setItem(SystemConfig.configStorageName, JSON.stringify(this.configData));
    }

    /*************************************/
    flush() {
        /* If the current configuration data object has been modified, stores it to
        localStorage and resets the flush timer */

        if (this.flushTimerToken) {
            clearTimeout(this.flushTimerToken);
            this.flushHandler();
        }
    }

    /*******************************************************************
    *   Configuration Node Management                                  *
    *******************************************************************/

    /**************************************/
    getNode(nodeName, index) {
        /* Retrieves a specified node of the configuration data object tree.
        "nodeName" specifies the node using dotted-path format. A blank name
        retrieves the entire tree. If the "index" parameter is specified, the
        final node in the path is assumed to be an array or object, and "index"
        used to return that element of the array or object. If a node does not
        exist, returns undefined */
        let node = this.configData;

        const name = nodeName.trim();
        if (name.length > 0) {
            const names = name.split(".");
            for (let name of names) {
                if (name in node) {
                    node = node[name];
                } else {
                    node = undefined;
                    break; // out of for loop
                }
            }
        }

        if (index === undefined) {
            return node;
        } else {
            return node[index];
        }
    }

    /**************************************/
    putNode(nodeName, data, index) {
        /* Creates or replaces a specified node of the configuration data object tree.
        "nodeName" specifies the node using dotted.path format. A blank name
        results in nothing being set. If a node does not exist, it and any necessary
        parent nodes are created. If the "index" parameter is specified, the final
        node in the path is assumed to be an array, and "index" is used to access
        that element of the array. Setting the value of a node starts a timer  (if it
        is not already started). When that timer expires, the configuration data will
        be flushed to the localStorage object. This delayed storage is done so that
        several configuration changes in short order can be grouped in one flush */
        let node = this.configData;

        const name = nodeName.trim();
        if (name.length > 0) {
            let lastName = name;
            let lastNode = node;
            const names = name.split(".");
            for (let name of names) {
                lastName = name;
                lastNode = node;
                if (name in node) {
                    node = node[name];
                } else {
                    node = node[name] = {};
                }
            } // for x

            if (index === undefined) {
                lastNode[lastName] = data;
            } else {
                lastNode[lastName][index] = data;
            }

            if (!this.flushTimerToken) {
                this.flushTimerToken = setTimeout(this.boundFlushHandler, SystemConfig.flushDelay);
            }
        }
    }

    /**************************************/
    getWindowProperty(id, prop) {
        /* Returns a WindowConfig property value based on the specified unit/
        window id and the property name. If the property does not exist,
        returns undefined */
        const wc = this.configData.WindowConfig;
        let value;                      // undefined by default

        const mode = wc.mode;
        if (mode in wc.modes) {
            if (id in wc.modes[mode]) {
                const unit = wc.modes[mode][id];
                if (prop in unit) {
                    value = unit[prop];
                }
            }
        }

        return value;
    }

    /**************************************/
    formatWindowGeometry(id) {
        /* Formats a string fragment for the window.open() method to set the
        geometry for the specified window/unit id. Returns an empty string if
        persistent window positions is not enabled (in which case the caller
        should do its automatic window placement), otherwise returns the
        geometry string */
        const cd = this.configData;
        let geometry = "";

        if (cd.persistentWindows) {
            const wc = cd.WindowConfig;
            const mode = wc.mode;
            if (mode in wc.modes) {
                if (id in wc.modes[mode]) {
                    const unit = wc.modes[mode][id];
                    geometry = `,left=${unit.screenX ?? 0}` +
                               `,top=${unit.screenY ?? 0}` +
                               `,innerWidth=${unit.innerWidth ?? 150}` +
                               `,innerHeight=${unit.innerHeight ?? 150}`;
                }
            }
        }

        return geometry;
    }

    /**************************************/
    getWindowGeometry(id) {
        /* Returns an array of geometry properties for the specified window
        under the specified window/unit id */
        const prefix = `WindowConfig.modes.${this.configData.WindowConfig.mode}.${id}`;

        return [this.getNode(`${prefix}.innerWidth`), this.getNode(`${prefix}.innerHeight`),
                this.getNode(`${prefix}.screenX`), this.getNode(`${prefix}.screenY`)];
    }

    /**************************************/
    putWindowGeometry(win, id) {
        /* Stores the geometry for the specified window under the specified
        window/unit id */
        const prefix = `WindowConfig.modes.${this.configData.WindowConfig.mode}.${id}`;

        this.putNode(`${prefix}.screenX`, win.screenX);
        this.putNode(`${prefix}.screenY`, win.screenY);
        this.putNode(`${prefix}.innerWidth`, win.innerWidth);
        this.putNode(`${prefix}.innerHeight`, win.innerHeight);
    }

    /**************************************/
    restoreWindowGeometry(win, width, height, left, top) {
        /* Resize the window to its configured size, taking into account the
        difference between inner and outer heights (WebKit quirk) */
        const dh = height - win.innerHeight;
        const dw = width  - win.innerWidth;
        const dx = left   - win.screenX;
        const dy = top    - win.screenY;

        win.resizeBy(dw, dh);
        setTimeout(() => {
            win.moveBy(dx, dy);
        }, 100);
    }

    /***********************************************************************
    *   System Configuration UI Support                                    *
    ***********************************************************************/

    /**************************************/
    setListValue(id, value) {
        /* Sets the selection of the <select> list with the specified "id" to the
        entry with the specified "value". If no such value exists, the list
        selection is not changed */
        const e = this.$$(id);

        if (e && e.tagName == "SELECT") {
            const opt = e.options;
            for (let x=0; x<opt.length; ++x) {
                if (opt[x].value == value.toString()) {
                    e.selectedIndex = x;
                    break; // out of for loop
                }
            } // for x
        }
    }

    /**************************************/
    loadConfigDialog() {
        /* Loads the configuration UI window with the settings from this.configData */
        const cd = this.configData;     // local configuration reference
        let x;                          // scratch
        let y;                          // scratch

        // System Properties
        this.$$("SystemPersistentWin").checked = cd.persistentWindows;
        this.$$("SystemMultiScreen").checked = cd.multiScreen;
        this.$$("SystemMultiScreen").disabled = !cd.persistentWindows;

        // Typewriter
        this.$$("MarginLeft").value = x = cd.Typewriter.marginLeft;
        this.$$("Columns").value = cd.Typewriter.columns;
        this.$$("TabStops").value = cd.Typewriter.tabs;

        // Plotter
        //if (cd.PaperTapePunch.hasPaperTapePunch) {
        //    cd.Plotter.hasPlotter = 0;  // can't have both PT Punch and Plotter at same time
        //}

        //this.$$("PaperTapePunchModel").disabled = (cd.Plotter.hasPlotter);
        this.setListValue("PlotterModel", cd.Plotter.hasPlotter ? cd.Plotter.plotterModel : 0);
        this.setListValue("PlotterScale", cd.Plotter.scale);
        this.setListValue("PlotterMaxHeight", cd.Plotter.maxHeight);
        this.$$("PlotterVisibleCarriage").checked = cd.Plotter.visibleCarriage;

        this.$$("MessageArea").textContent = "G-15 System Configuration loaded.";
        this.window.focus();
    }

    /**************************************/
    changeConfig(ev) {
        /* Handles the onChange event for elements in the configDiv element */
        const cd = this.configData;     // local configuration reference
        const id = ev.target.id;        // id of changed element
        let v = 0;

        const editInteger = (s, min, max, caption) => {
            let v = parseInt(s, 10);
            if (isNaN(v)) {
                this.window.alert(`${caption} invalid value: "${s}"`);
            } else if (v < min || v > max) {
                this.window.alert(`${caption} out of valid range (${min}, ${max})`);
                v = NaN;
            }

            return v;
        };

        switch (id) {
        case "SystemPersistentWin":
            this.$$("SystemMultiScreen").disabled = !ev.target.checked;
            break;
        case "MarginLeft":
            v = editInteger(ev.target.value, 0, 255, "Margin Left");
            if (!isNan(v)) {
                cd.Typewriter.marginLeft = v;
                ev.target.value = v;
            }
            break;
        case "Columns":
            v = editInteger(ev.target.value, 0, 255, "Columns");
            if (!isNan(v)) {
                cd.Typewriter.columns = v;
                ev.target.value = v;
            }
            break;
        case "TabStops":
            let tabs = [];
            let list = ev.target.value.split(",");
            let lastTab = 0;
            for (let stop of list) {
                if (stop.trim().length > 0) {
                    v = editInteger(stop, 1, 255, "Tab stop");
                    if (isNaN(v)) {
                        return;
                    } else if (v <= lastTab) {
                        this.window.alert(`Tab stop ${stop} out of order`);
                        return;
                    } else {
                        lastTab = v;
                        tabs.push(v);
                    }
                }
            }
            cd.tabs = tabs.join(",");
            ev.target.value = cd.tabs;
            break;
        case "PlotterModel":
            //if (ev.target.selectedIndex > 0 && this.$$("PaperTapePunchModel").selectedIndex > 0) {
            //    this.alertWin.alert("Cannot enable Plotter and Paper Tape Punch at same time");
            //} else {
            //    this.$$("PaperTapePunchModel").disabled = (ev.target.selectedIndex > 0);
            //}
            break;
        }
    }

    /**************************************/
    saveConfigDialog() {
        /* Saves the configuration UI window settings to this.configData and flushes
        the updated configuration to localStorage */
        const cd = this.configData;     // local configuration reference
        let e = null;                   // local element reference
        let x = 0;                      // scratch

        function getNumber(id, caption, min, max) {
            let text = this.$$(id).value;
            let n = parseInt(text, 10);

            if (isNaN(n)) {
                this.alertWin.alert(caption + " must be numeric");
            } else if (n < min || n > max) {
                this.alertWin.alert(caption + " must be in the range (" + min + ", " + max + ")");
                n = Number.NaN;
            }

            return n;
        }

        // System Properties
        cd.persistentWindows =  (this.$$("SystemPersistentWin").checked ? 1 : 0);
        this.$$("SystemMultiScreen").enabled = !cd.persistentWindows;
        cd.multiScreen =        (this.$$("SystemMultiScreen").checked ? 1 : 0);

        // Typewriter
        e = this.$$("MarginLeft");
        x = Math.min(Math.max(parseInt(e.value, 10) ?? 0, 0), 255);
        cd.Typewriter.marginLeft = x;
        e = this.$$("Columns")
        x = Math.min(Math.max(parseInt(e.value, 10) ?? 0, 0), 255);
        cd.Typewriter.columns = x;
        cd.Typewriter.tabs = this.$$("TabStops").value.trim();

        // Plotter
        e = this.$$("PlotterModel");
        //if (e.selectedIndex > 0 && this.$$("PaperTapePunchModel").selectedIndex > 0 && cd.PaperTapePunch.hasPaperTapePunch) {
        //    e.selectedIndex = 0;
        //    this.alertWin.alert("Cannot enable  Plotter when Paper Tape Punch is enabled.");
        //} else {
            x = e.selectedIndex;
            cd.Plotter.hasPlotter = (x > 0 ? 1 : 0);
            cd.Plotter.plotterModel = parseInt(e.options[x].value, 10) || 0;
        //    this.$$("PaperTapePunchModel").disabled = (x > 0);
        //}

        e = this.$$("PlotterScale");
        cd.Plotter.scale = (e.selectedIndex > 0 ? 2 : 1);
        e = this.$$("PlotterMaxHeight");
        x = parseInt(e.options[e.selectedIndex].value, 10);
        cd.Plotter.maxHeight = (isNaN(x) ? 4096 : x);
        e = this.$$("PlotterVisibleCarriage");
        cd.Plotter.visibleCarriage = (e.checked ? 1 : 0);

        this.determineWindowConfigMode().then((msg) => {
            this.flushHandler();        // store the configuration
            this.$$("MessageArea").textContent = msg;
            this.configReporter?.(msg);
            this.window.close();
        });
    }

    /**************************************/
    closeConfigUI() {
        /* Closes the system configuration update dialog */

        this.alertWin = window;         // revert alerts to the global window
        window.focus();
        this.configReporter = null;
        if (this.doc) {
            this.$$("SaveBtn").removeEventListener("click", this.boundSaveConfigDialog, false);
            this.$$("CancelBtn").removeEventListener("click", this.boundWindowClose, false);
            this.$$("DefaultsBtn").removeEventListener("click", this.boundSetDefaultConfig, false);
            this.$$("configDiv").removeEventListener("change", this.boundChangeConfig, false);
            this.window.removeEventListener("unload", this.boundCloseConfigUI, false);
        }

        if (this.window) {
            if (!this.window.closed) {
                this.window.close();
            }

            this.doc = null;
            this.window = null;
        }
    }

    /**************************************/
    openConfigUI(configReporter) {
        /* Opens the system configuration update dialog and displays the current
        system configuration */
        const configWidth = Math.max(Math.min(window.innerWidth, 740), 600);
        const configHeight = screen.availHeight*0.9;

        function configUI_Load(ev) {
            this.doc = ev.target;
            this.window = this.doc.defaultView;
            this.window.moveTo(screen.availWidth-this.window.outerWidth-40,
                               (screen.availHeight-this.window.outerHeight)/2);
            this.window.focus();
            this.alertWin = this.window;
            this.$$("SaveBtn").addEventListener("click", this.boundSaveConfigDialog, false);
            this.$$("CancelBtn").addEventListener("click", this.boundWindowClose, false);
            this.$$("DefaultsBtn").addEventListener("click", this.boundSetDefaultConfig, false);
            this.$$("configDiv").addEventListener("change", this.boundChangeConfig, false);
            this.window.addEventListener("unload", this.boundCloseConfigUI, false);
            this.loadConfigDialog();
        }

        this.doc = null;
        this.window = null;
        this.configReporter = configReporter;
        openPopup(window, "../webUI/SystemConfig.html", `retro-1620.${SystemConfig.configStorageName}`,
                `location=no,scrollbars,resizable,width=${configWidth},height=${configHeight}`,
                this, configUI_Load);
    }
} // SystemConfig class
