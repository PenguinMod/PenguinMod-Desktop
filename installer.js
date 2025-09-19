const Unzipper = require("decompress-zip");
const childProcess = require("child_process");
const path = require("path");

// note: this does not need to be a secret, its just used to check if PM is actually installed on startup
const verificationKey = "WVVkR2IxbFRRakZKUjNoMllqSjBiRnBCUFQwPQ==";

const connectionVerify = "https://penguinmod.com/favicon.ico";
const archivePath = "https://github.com/PenguinMod/penguinmod.github.io/archive/refs/heads/develop.zip";
const homePath = "https://github.com/PenguinMod/PenguinMod-Home/archive/refs/heads/main.zip";
class Installer {
    static logs = [];
    static _listeners = [];
    static fs;

    static log(text) {
        console.log(text);
        Installer.logs.push(String(text));
        for (const listener of Installer._listeners) {
            listener(String(text));
        }
    }
    static addLogListener(listener) {
        Installer._listeners.push(listener);
    }

    static wait(ms) {
        return new Promise((resolve) => {
            const time = Date.now();
            setTimeout(() => {
                resolve(Date.now() - time);
            }, ms);
        });
    }
    static checkOnline() {
        return new Promise((resolve) => {
            fetch(connectionVerify).then(res => {
                if (!res.ok) {
                    resolve(false);
                    return;
                }
                resolve(true);
            }).catch(() => {
                resolve(false);
            });
        })
    }
    /**
     * fs.writeFile but as a promise
     */
    static writeFile(path, data, options) {
        return new Promise((resolve, reject) => {
            const callback = (err) => {
                if (err) return reject(err);
                resolve();
            };
            if (!options) {
                return Installer.fs.writeFile(path, data, callback);
            }
            Installer.fs.writeFile(path, data, options, callback);
        });
    }
    /**
     * child_process.exec but as a promise
     */
    static exec(command, options) {
        return new Promise((resolve, reject) => {
            const callback = (error, stdout, stderr) => {
                if (error) return reject({ error, stdout, stderr });
                resolve({ stdout, stderr });
            };
            if (options) {
                childProcess.exec(command, options, callback);
            }
            childProcess.exec(command, callback);
        });
    }

    static async getCommandResultAsVersion(command) {
        let result = { error: null, stdout: "", stderr: "" };
        try {
            result = await Installer.exec(command);
        } catch {
            return;
        }
        let version = String(result.stdout).trim().replace(/v/gmi, '');
        version = version.replace('.', ',');
        version = version.replace(/[^0-9,]+/gmi, '');
        version = version.replace(',', '.');
        version = version.replace(/,/gmi, '');
        return Number(version);
    }
    static async getNodeVersion() {
        const result = await Installer.getCommandResultAsVersion('node -v');
        return result;
    }
    static async getNpmVersion() {
        const result = await Installer.getCommandResultAsVersion('npm -v');
        return result;
    }

    static async install(filepath) {
        // gives time for the app to be closed probably
        Installer.log('Prepping installation, please wait...');
        await Installer.wait(1000);

        // check for node
        // if not found, send them to https://nodejs.org/en/download
        Installer.log('Checking for Node...');
        const notInstalledMessage = 'PenguinMod Launcher requires Node + NPM to work.\nThe installation page for Node will open now.\n\nPlease select "LTS" and choose the option with your operating system.\n\nAfter installation, you will need to restart the app and you may need to restart your computer.';
        const nodeVersion = await Installer.getNodeVersion();
        if (nodeVersion && (nodeVersion >= 16)) {
            console.log(nodeVersion);
            Installer.log(`Node is already installed and up-to-date.`);
        } else {
            Installer.log('Node was either not found or older than v16. Opening installation page.');
            alert(notInstalledMessage);
            window.open('https://nodejs.org/en/download');
            throw new Error('Node not found or older than v16.');
        }
        // return; // debug

        // check for npm
        // if not found, send them to https://nodejs.org/en/download
        Installer.log('Checking for NPM...');
        const npmVersion = await Installer.getNpmVersion();
        if (npmVersion && (npmVersion >= 7)) {
            console.log(npmVersion);
            Installer.log(`NPM is already installed and up-to-date.`);
        } else {
            Installer.log('NPM was either not found or older than v7. Opening installation page.');
            alert(notInstalledMessage);
            window.open('https://nodejs.org/en/download');
            throw new Error('NPM not found or older than v7.');
        }
        // return; // debug

        const realPath = path.join(__dirname, filepath);
        Installer.log(`Installing to ${realPath}`);

        // debug
        // throw new Error('Debug');

        // create directories
        Installer.log('Creating directories...');
        try {
            // this will create all directories here, so we dont need to individually do it
            Installer.fs.mkdirSync(path.join(__dirname, "./penguinmod/compilation/extraction"), { recursive: true });
            // throw new Error('Debug');
        } catch (err) {
            Installer.log(`Unexpected error creating directories: ${err}`);
            throw new Error(`Unexpected error creating directories: ${err}`);
        }

        // make sure we are online for this
        Installer.log('Checking connection, please wait...');
        const connectionTestTime = Date.now();
        // this just accesses a PM icon, doesnt query github so we dont get ratelimited
        const connectedOnline = await Installer.checkOnline();
        if (!connectedOnline) {
            // if (true) { // debug
            Installer.log('Failed connection test. You may not be connected to the internet.');
            Installer.log('Please click "Refresh" to try again when you are ready.');
            throw new Error('Unable to view PenguinMod');
        }
        // we are online, now we can query github
        Installer.log(`Passed connection test. (${Date.now() - connectionTestTime}ms)`);
        Installer.log('Please wait, grabbing repository contents...');

        // ---- INSTALLATION ----
        // Install Home Page
        Installer.log(`Grabbing repository from "${homePath}"`);
        await (async () => {
            let response;
            try {
                // TODO: should we fetch with user agent headers for github to know the app name
                response = await fetch(homePath);
                // throw new Error('Debug');
            } catch (err) {
                Installer.log('Failed to get the home ZIP file!');
                Installer.log('You may not be connected to the internet.');
                Installer.log(`${err}`);
                throw new Error(`Unexpected error fetching archive: ${err}`);
            }

            // we need to convert to array boofer
            Installer.log('Processing...');
            let arraybuffer;
            try {
                arraybuffer = await response.arrayBuffer();
                // throw new Error('Debug');
            } catch (err) {
                Installer.log('Unknown error getting ArrayBuffer.');
                Installer.log(`${err}`);
                throw new Error(`Unknown error getting ArrayBuffer: ${err}`);
            }

            // save
            Installer.log('Downloading archive...');
            const downloadedArchivePath = path.join(filepath, "/_repository_h.zip");
            try {
                const buffer = Buffer.from(arraybuffer);
                await Installer.writeFile(downloadedArchivePath, buffer);
                // throw new Error('Debug');
            } catch (err) {
                Installer.log('Failed to download PenguinMod to device!');
                Installer.log('You may not have enough storage space. It is recommended that at least 2.5 GB is free for the full installation process.');
                Installer.log('If you do not have enough space on your main drive, try moving the Launcher folder to another drive.');
                Installer.log(`${err}`);
                throw new Error(`Failed to write file: ${err}`);
            }

            // unzip
            Installer.log('Extracting archive...');

            // we made this dir earlier to make sure we could but just remake it to clear its contents
            const extractedArchivePath = path.resolve(path.join(filepath, "/extractionhome"));
            Installer.fs.rmSync(extractedArchivePath, { recursive: true, force: true });
            Installer.fs.mkdirSync(extractedArchivePath, { recursive: true });

            // create extractor so we can listen for events
            const extractor = new Unzipper(downloadedArchivePath);
            extractor.on('error', (err) => {
                Installer.log('Failed to extract ZIP archive file.');
                Installer.log('You may need to manually reopen the Launcher application to try again.');
                Installer.log(`${err}`);
                throw new Error(`Failed to extract zip archive: ${err}`);
            });
            extractor.on('progress', (fileIndex, fileCount) => {
                Installer.log('Extracted file ' + (fileIndex + 1) + ' of ' + fileCount);
            });

            const waitingExtraction = new Promise((resolve) => {
                extractor.on('extract', () => {
                    Installer.log("Finished extracting");
                    resolve();
                });
            });

            extractor.extract({
                path: extractedArchivePath,
                restrict: true, // prevents some security problems
                filter: function (file) {
                    return file.type !== "SymbolicLink"; // same here
                }
            });
            await waitingExtraction;
        })();
        // Install GUI
        
        Installer.log(`Grabbing repository from "${archivePath}"`);
        await (async () => {
            let response;
            try {
                // TODO: should we fetch with user agent headers for github to know the app name
                response = await fetch(archivePath);
                // throw new Error('Debug');
            } catch (err) {
                Installer.log('Failed to get the GUI repository ZIP file!');
                Installer.log('You may not be connected to the internet.');
                Installer.log(`${err}`);
                throw new Error(`Unexpected error fetching archive: ${err}`);
            }

            // we need to convert to array boofer
            Installer.log('Processing...');
            let arraybuffer;
            try {
                arraybuffer = await response.arrayBuffer();
                // throw new Error('Debug');
            } catch (err) {
                Installer.log('Unknown error getting ArrayBuffer.');
                Installer.log(`${err}`);
                throw new Error(`Unknown error getting ArrayBuffer: ${err}`);
            }

            // save
            Installer.log('Downloading archive...');
            const downloadedArchivePath = path.join(filepath, "/_repository_g.zip");
            try {
                const buffer = Buffer.from(arraybuffer);
                await Installer.writeFile(downloadedArchivePath, buffer);
                // throw new Error('Debug');
            } catch (err) {
                Installer.log('Failed to download PenguinMod to device!');
                Installer.log('You may not have enough storage space. It is recommended that at least 2.5 GB is free for the full installation process.');
                Installer.log('If you do not have enough space on your main drive, try moving the Launcher folder to another drive.');
                Installer.log(`${err}`);
                throw new Error(`Failed to write file: ${err}`);
            }

            // unzip
            Installer.log('Extracting archive...');

            // we made this dir earlier to make sure we could but just remake it to clear its contents
            const extractedArchivePath = path.resolve(path.join(filepath, "/extractiongui"));
            Installer.fs.rmSync(extractedArchivePath, { recursive: true, force: true });
            Installer.fs.mkdirSync(extractedArchivePath, { recursive: true });

            // create extractor so we can listen for events
            const extractor = new Unzipper(downloadedArchivePath);
            extractor.on('error', (err) => {
                Installer.log('Failed to extract ZIP archive file.');
                Installer.log('You may need to manually reopen the Launcher application to try again.');
                Installer.log(`${err}`);
                throw new Error(`Failed to extract zip archive: ${err}`);
            });
            extractor.on('progress', (fileIndex, fileCount) => {
                Installer.log('Extracted file ' + (fileIndex + 1) + ' of ' + fileCount);
            });

            const waitingExtraction = new Promise((resolve) => {
                extractor.on('extract', () => {
                    Installer.log("Finished extracting");
                    resolve();
                });
            });

            extractor.extract({
                path: extractedArchivePath,
                restrict: true, // prevents some security problems
                filter: function (file) {
                    return file.type !== "SymbolicLink"; // same here
                }
            });
            await waitingExtraction;
        })();
        

        // ---- COMPILATION ----
        const extractedHomeArchivesPath = path.resolve(path.join(filepath, "/extractionhome"));
        const extractedGuiArchivesPath = path.resolve(path.join(filepath, "/extractiongui"));

        // Compile Home Page
        const homePagePath = path.join(extractedHomeArchivesPath, 'PenguinMod-Home-main');
            Installer.log('Downloading all dependencies for Home, please wait...');
            // we cant actually compile svelte locally, so we will just run in dev later
            try {
                const result = await Installer.exec(`cd ${JSON.stringify(homePagePath)} && npm i --force`);
                if (result && result.error) {
                    Installer.log('Dependency install failed: ' + JSON.stringify(result));
                    throw new Error('Dependency install failed: ' + JSON.stringify(result));
                }
            } catch (err) {
                Installer.log('Dependency install threw: ' + (err && err.stack ? err.stack : err));
                throw err;
            }
        // Compile GUI page
        const editorPagePath = path.join(extractedGuiArchivesPath, 'penguinmod.github.io-develop');
            Installer.log('Downloading all dependencies for Editor, please wait...');
            // we cant actually compile svelte locally, so we will just run in dev later
            try {
                const result = await Installer.exec(`cd ${JSON.stringify(editorPagePath)} && npm i --force`);
                if (result && result.error) {
                    Installer.log('Dependency install failed: ' + JSON.stringify(result));
                    throw new Error('Dependency install failed: ' + JSON.stringify(result));
                }
            } catch (err) {
                Installer.log('Dependency install threw: ' + (err && err.stack ? err.stack : err));
                throw err;
            }

        // create the verification file (used by the base program to see if penguinmod is even installed at all)
        Installer.log('Creating verification...');
        const verificationPath = path.resolve(path.join(filepath, "verification.txt"));
        await Installer.writeFile(verificationPath, verificationKey, "utf8");

        Installer.log('Actions completed');
        await Installer.wait(1000);
    }
}

module.exports = Installer;