/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*global describe, it, expect, beforeFirst, afterLast, beforeEach, afterEach, waitsFor, runs, waitsForDone */

define(function (require, exports, module) {


    var SpecRunnerUtils  = require("spec/SpecRunnerUtils"),
        ExtensionLoader  = require("utils/ExtensionLoader"),
        FileSystem       = require("filesystem/FileSystem"),
        Package          = require("extensibility/Package"),
        NodeConnection   = require("utils/NodeConnection");

    var testFilePath = SpecRunnerUtils.getTestPath("/spec/extension-test-files");

    var tempDirectory = SpecRunnerUtils.getTempDirectory();
    var extensionsRoot = tempDirectory + "/extensions";

    var basicValid          = testFilePath + "/basic-valid-extension.zip",
        missingNameVersion  = testFilePath + "/missing-name-version.zip",
        incompatibleVersion = testFilePath + "/incompatible-version.zip";

    var packageData;

    function handlePackage(packagePath, packageFunc) {
        var promise;

        packageData = undefined;

        runs(function () {
            // Matches NodeConnection CONNECTION_TIMEOUT
            waitsForDone(Package._getNodeConnectionDeferred(), "ExtensionManagerDomain load", NodeConnection._getConnectionTimeout());
        });

        runs(function () {
            promise = packageFunc(packagePath);
            promise.then(function (pd) {
                // perform checks outside of this function to avoid
                // getting caught by NodeConnection's error catcher
                packageData = pd;
            }, function (err) {
                expect(err).toBeNull();
            });

            waitsForDone(promise, "package validation", 5000);
        });
    }

    function validatePackage(packagePath) {
        handlePackage(packagePath, Package.validate);
    }

    function installPackage(packagePath) {
        handlePackage(packagePath, Package.install);
    }

    describe("Extension Installation", function () {
        it("should return information about a valid file", function () {
            validatePackage(basicValid);

            runs(function () {
                expect(packageData.errors.length).toEqual(0);
                expect(packageData.metadata.name).toEqual("basic-valid-extension");
                expect(packageData.metadata.title).toEqual("Basic Valid Extension");
                expect(packageData.metadata.version).toEqual("1.0.0");
            });
        });

        it("should detect missing metadata", function () {
            validatePackage(missingNameVersion);

            runs(function () {
                expect(packageData.errors.length).toEqual(2);
                expect(packageData.errors[0][0]).toEqual("MISSING_PACKAGE_NAME");
                expect(packageData.errors[1][0]).toEqual("MISSING_PACKAGE_VERSION");
            });
        });


        // The code that follows mocks out the bits of ExtensionLoader that are
        // used during installation so that the extension is not *actually*
        // loaded after it's installed.
        var realGetUserExtensionPath, realLoadExtension, lastExtensionLoad;

        function mockGetUserExtensionPath() {
            return extensionsRoot + "/user";
        }

        function mockLoadExtension(name, config, entryPoint) {
            var d = $.Deferred();
            lastExtensionLoad.name = name;
            lastExtensionLoad.config = config;
            lastExtensionLoad.entryPoint = entryPoint;
            d.resolve();
            return d.promise();
        }

        beforeFirst(function () {
            SpecRunnerUtils.createTempDirectory();
        });

        afterLast(function () {
            SpecRunnerUtils.removeTempDirectory();
        });

        beforeEach(function () {
            realGetUserExtensionPath = ExtensionLoader.getUserExtensionPath;
            ExtensionLoader.getUserExtensionPath = mockGetUserExtensionPath;

            lastExtensionLoad = {};
            realLoadExtension = ExtensionLoader.loadExtension;
            ExtensionLoader.loadExtension = mockLoadExtension;
        });

        afterEach(function () {
            ExtensionLoader.getUserExtensionPath = realGetUserExtensionPath;
            ExtensionLoader.loadExtension = realLoadExtension;
            var promise = SpecRunnerUtils.deletePath(mockGetUserExtensionPath(), true);
            waitsForDone(promise, "Mock Extension Removal", 2000);
        });

        it("extensions should install and load", function () {
            installPackage(basicValid);

            var mainCheckComplete = false;

            runs(function () {
                expect(packageData.errors.length).toEqual(0);
                expect(packageData.name).toEqual("basic-valid-extension");

                // confirm that the extension would have been loaded had we not
                // mocked the loading part
                expect(lastExtensionLoad.name).toEqual("basic-valid-extension");
                var expectedPath = mockGetUserExtensionPath() + "/basic-valid-extension";
                expect(lastExtensionLoad.config.baseUrl).toEqual(expectedPath);
                expect(lastExtensionLoad.entryPoint).toEqual("main");
                FileSystem.resolve(extensionsRoot + "/user/basic-valid-extension/main.js", function (err, item) {
                    if (!err) {
                        mainCheckComplete = true;
                    } else {
                        mainCheckComplete = true;
                        expect("basic-valid-extension directory and main.js to exist").toEqual(true);
                    }
                });
            });

            waitsFor(function () { return mainCheckComplete; }, 1000, "checking for main.js file");
        });

        it("extensions should install disabled if they are not compatible", function () {
            installPackage(incompatibleVersion);

            var directoryCheckComplete = false;

            runs(function () {
                expect(packageData.errors.length).toEqual(0);
                expect(packageData.disabledReason).toBeTruthy();
                expect(packageData.name).toEqual("incompatible-version");
                expect(lastExtensionLoad).toEqual({});
                FileSystem.resolve(extensionsRoot + "/disabled/incompatible-version", function (err, item) {
                    if (!err) {
                        directoryCheckComplete = true;
                    } else {
                        directoryCheckComplete = true;
                        expect("incompatible-version path to exist in the disabled directory").toEqual(true);
                    }
                });

                waitsFor(function () { return directoryCheckComplete; }, 1000, "checking for disabled extension directory");

            });
        });

        it("should remove an installed extension", function () {
            var installPath, checkComplete = false;
            installPackage(basicValid);
            runs(function () {
                installPath = lastExtensionLoad.config.baseUrl;
                handlePackage(installPath, Package.remove);
            });
            runs(function () {
                FileSystem.resolve(installPath, function (err, item) {
                    if (!err) {
                        checkComplete = true;
                        expect("installation path was removed").toEqual(true);
                    } else {
                        checkComplete = true;
                    }
                });

                waitsFor(function () { return checkComplete; }, 1000, "checking for extension folder removal");
            });
        });
    });
});
