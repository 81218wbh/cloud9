/**
 * Code Editor for the Cloud9 IDE
 *
 * @TODO
 * - Save & load scroll position of tree
 * 
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

var ide = require("core/ide");
var ext = require("core/ext");
var util = require("core/util");
var fs = require("ext/filesystem/filesystem");
var settings = require("ext/settings/settings");
var panels = require("ext/panels/panels");
var markup = require("text!ext/tree/tree.xml");

module.exports = ext.register("ext/tree/tree", {
    name             : "Project Files",
    dev              : "Ajax.org",
    alone            : true,
    type             : ext.GENERAL,
    markup           : markup,

    defaultWidth     : 200,

    deps             : [fs],

    currentSettings  : [],
    expandedList     : {},
    loading          : false,
    changed          : false,
    animControl      : {},
    nodes            : [],

    "default"        : true,

    hook : function(){
        panels.register(this, {
            position : 1000,
            caption: "Project Files",
            "class": "project_files"
        });
    },

    init : function() {
        var _self = this;

        this.panel = winFilesViewer;

        this.nodes.push(winFilesViewer);

        colLeft.addEventListener("hide", function(){
            splitterPanelLeft.hide();
        });

        colLeft.addEventListener("show", function() {
           splitterPanelLeft.show();
        });

        colLeft.appendChild(winFilesViewer);

        mnuFilesSettings.appendChild(new apf.item({
            id      : "mnuitemHiddenFiles",
            type    : "check",
            caption : "Show Hidden Files",
            visible : "{trFiles.visible}",
            checked : "[{require('ext/settings/settings').model}::auto/tree/@showhidden]",
            onclick : function(){
                _self.changed = true;
                (davProject.realWebdav || davProject)
                    .setAttribute("showhidden", this.checked);

                _self.refresh();
                settings.save();
            }
        }));

        ide.addEventListener("loadsettings", function(e) {
            var model = e.model;
            (davProject.realWebdav || davProject).setAttribute("showhidden",
                apf.isTrue(model.queryValue('auto/tree/@showhidden')));
        });

        mnuView.appendChild(new apf.divider());

        trFiles.setAttribute("model", fs.model);

        trFiles.addEventListener("afterselect", this.$afterselect = function(e) {
            if (settings.model && settings.model.data && trFiles.selected) {
                var settingsData      = settings.model.data;
                var treeSelectionNode = settingsData.selectSingleNode("auto/tree_selection");
                var nodeSelected      = trFiles.selected.getAttribute("path");
                var nodeType          = trFiles.selected.getAttribute("type");
                if(treeSelectionNode) {
                    apf.xmldb.setAttribute(treeSelectionNode, "path", nodeSelected);
                    apf.xmldb.setAttribute(treeSelectionNode, "type", nodeType);
                }
                else
                    apf.xmldb.appendChild(settingsData.selectSingleNode("auto"),
                        apf.getXml('<tree_selection path="' + nodeSelected +
                            '" type="' + nodeType + '" />')
                    );
            }
        });

        trFiles.addEventListener("afterchoose", this.$afterchoose = function() {
            var node = this.selected;
            if (!node || node.tagName != "file" || this.selection.length > 1 ||
                !ide.onLine && !ide.offlineFileSystemSupport) //ide.onLine can be removed after update apf
                    return;

            ide.dispatchEvent("openfile", {doc: ide.createDocument(node)});
        });

        trFiles.addEventListener("beforecopy", function(e) {
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;

            var args     = e.args[0].args,
                filename = args[1].getAttribute("name");

            var count = 0;
            filename.match(/\.(\d+)$/, "") && (count = parseInt(RegExp.$1, 10));
            while (args[0].selectSingleNode("node()[@name='" + filename.replace(/'/g, "\\'") + "']")) {
                filename = filename.replace(/\.(\d+)$/, "") + "." + ++count;
            }
            args[1].setAttribute("newname", filename);

            setTimeout(function () {
                fs.beforeRename(args[1], null,
                    args[0].getAttribute("path").replace(/[\/]+$/, "") +
                    "/" + filename, true);
                args[1].removeAttribute("newname");
            });
        });

        trFiles.addEventListener("beforestoprename", function(e) {
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;

            return fs.beforeStopRename(e.value);
        });

        trFiles.addEventListener("beforerename", function(e){
            if (!ide.onLine && !ide.offlineFileSystemSupport) return false;

            if(trFiles.$model.data.firstChild == trFiles.selected)
                return false;

            // check for a path with the same name, which is not allowed to rename to:
            var path = e.args[0].getAttribute("path"),
                newpath = path.replace(/^(.*\/)[^\/]+$/, "$1" + e.args[1]).toLowerCase();

            var exists, nodes = trFiles.getModel().queryNodes(".//node()");
            for (var i = 0, len = nodes.length; i < len; i++) {
                var pathLwr = nodes[i].getAttribute("path").toLowerCase();
                if (nodes[i] != e.args[0] && pathLwr === newpath) {
                    exists = true;
                    break;
                }
            }

            if (exists) {
                util.alert("Error", "Unable to Rename",
                    "That name is already taken. Please choose a different name.");
                trFiles.getActionTracker().undo();
                return false;
            }

            fs.beforeRename(e.args[0], e.args[1]);
        });

        trFiles.addEventListener("beforemove", function(e){
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;

            setTimeout(function(){
                var changes = e.args;
                for (var i = 0; i < changes.length; i++) {
                    // If any file exists in its future destination, cancel the event.
                    fs.beforeMove(changes[i].args[0], changes[i].args[1], trFiles);
                }
            });
        });

        var cancelWhenOffline = function(){
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;
        };

        trFiles.addEventListener("beforeadd", cancelWhenOffline);
        trFiles.addEventListener("renamestart", cancelWhenOffline);
        trFiles.addEventListener("beforeremove", cancelWhenOffline);
        trFiles.addEventListener("dragstart", cancelWhenOffline);
        trFiles.addEventListener("dragdrop", cancelWhenOffline);

        ide.addEventListener("filecallback", function (e) {
            _self.refresh();
        });

        /**** Support for state preservation ****/
        trFiles.addEventListener("expand", function(e){
            if (!e.xmlNode)
                return;
            _self.expandedList[e.xmlNode.getAttribute(apf.xmldb.xmlIdTag)] = e.xmlNode;

            if (!_self.loading) {
                _self.changed = true;
                settings.save();
            }
        });

        trFiles.addEventListener("collapse", function(e){
            if (!e.xmlNode)
                return;
            delete _self.expandedList[e.xmlNode.getAttribute(apf.xmldb.xmlIdTag)];

            if (!_self.loading) {
                _self.changed = true;
                settings.save();
            }
        });

        ide.addEventListener("loadsettings", function(e){
            _self.model = fs.model;

            function treeSelect(){
                var treeSelection = model.queryNode("auto/tree_selection");
                if(treeSelection) {
                    trFiles.select(trFiles.$model.queryNode('//node()[@path="' +
                        model.queryValue('auto/tree_selection/@path') +
                        '" and @type="' + model.queryValue('auto/tree_selection/@type') +
                        '"]')
                    );
                }
                else {
                    trFiles.select(trFiles.$model.queryNode("node()"));
                }
            }

            var model = e.model;
            var strSettings = model.queryValue("auto/tree");
            if (strSettings) {
                _self.loading = true;
                try {
                    _self.currentSettings = JSON.parse(strSettings);
                }
                catch (ex) {
                    //fail! revert to default
                    _self.currentSettings = [ide.davPrefix];
                }

                _self.loadProjectTree(function() {
                    treeSelect();
                });
            }
            else {
                trFilesInsertRule.setAttribute("get", "{davProject.readdir([@path])}");
                trFiles.expandAll();
            }
        });

        ide.addEventListener("savesettings", function(e){
            if (!_self.changed)
                return;

            var xmlSettings = apf.createNodeFromXpath(e.model.data, "auto/tree/text()");
            _self.currentSettings = [];

            var path, id, lut = {};
            for (id in _self.expandedList) {
                path = _self.expandedList[id].getAttribute("path");
                if (!path) {
                    delete _self.expandedList[id];
                }
                else {
                    lut[path] = true;
                }
            }

            var cc, parts;
            for (path in lut) {
                parts = path.split("/");
                cc = parts.shift();
                do {
                    if (!parts.length)
                        break;

                    cc += "/" + parts.shift();
                } while(lut[cc]);

                if (!parts.length)
                    _self.currentSettings.push(path);
            }

            xmlSettings.nodeValue = apf.serialize(_self.currentSettings);
            return true;
        });

        ide.addEventListener("treechange", function(e) {
            var path    = e.path.replace(/\/([^/]*)/g, "/node()[@name=\"$1\"]")
                                .replace(/\[@name="workspace"\]/, "")
                                .replace(/\//, ""),
                parent  = trFiles.getModel().data.selectSingleNode(path);
            if (!parent)
                return;

            var nodes   = parent.childNodes,
                files   = e.files,
                removed = [];

            for (var i = 0; i < nodes.length; ++i) {
                var node = nodes[i],
                    name = node.getAttribute("name");

                if (files && files[name])
                    delete files[name];
                else
                    removed.push(node);
            }
            removed.forEach(function (node) {
                apf.xmldb.removeNode(node);
            });
            path = parent.getAttribute("path");
            for (var name in files) {
                var file = files[name];

                xmlNode = "<" + file.type +
                    " type='" + file.type + "'" +
                    " name='" + name + "'" +
                    " path='" + path + "/" + name + "'" +
                "/>";
                trFiles.add(xmlNode, parent);
            }
        });
    },

    moveFile : function(path, newpath){
        davProject.move(path, newpath);
        trFiles.enable();
        trFiles.focus();
    },

    loadProjectTree : function(callback) {
        var currentSettings = this.currentSettings;
        var len = currentSettings.length;
        var _self = this;

        function getLoadPath(i) {
            if (i >= len)
                return onFinish();

            var path = currentSettings[i];
            davProject.realWebdav.readdir(path, function(data, state, extra) {
                var realPath = extra.url.substr(0, extra.url.length-1);
                var parentNode = trFiles.queryNode('//folder[@path="' + realPath + '"]');

                var xmlRoot = apf.getXml(data);
                for (var x = 0, xmlLen = xmlRoot.childNodes.length; x < xmlLen; x++)
                    trFiles.add(xmlRoot.childNodes[x], parentNode);

                trFiles.$setLoadStatus(parentNode, "loaded");
                trFiles.slideToggle(apf.xmldb.getHtmlNode(parentNode, trFiles), 1, true, null, function() {
                    getLoadPath(++i);
                });
            });
        }

        function onFinish() {
            _self.loading = false;
            trFilesInsertRule.setAttribute("get", "{davProject.readdir([@path])}");
            if (callback)
                return callback();
        }

        getLoadPath(0);
    },

    refresh : function(){
        trFiles.getModel().load("<data><folder type='folder' name='" +
            ide.projectName + "' path='" + ide.davPrefix +
            "' root='1'/></data>");
        this.expandedList = {};
        this.loading = true;

        trFilesInsertRule.setAttribute("get", "");

        ide.dispatchEvent("track_action", {type: "reloadtree"});
        try {
            var _self = this;
            this.loadProjectTree();
        } catch(e) {

        }
    },

    enable : function(){
        this.nodes.each(function(item){
            item.enable();
        });
    },

    disable : function(){
        this.nodes.each(function(item){
            item.disable();
        });
    },

    destroy : function(){
        trFiles.removeEventListener("afterselect", this.$afterselect);
        trFiles.removeEventListener("afterchoose", this.$afterchoose);
        this.nodes.each(function(item){
            item.destroy(true, true);
        });
        this.nodes = [];

        panels.unregister(this);
    }
});

});
