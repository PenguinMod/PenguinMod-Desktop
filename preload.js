const Installer = require("./installer");
const localResourceAvailable = require('./localresourceavailable');
const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");

// note: these do not need to be secret, they are just used to make sure we are doing the correct actions
const loadingScreenKey = "UnRJeVYyUk9Gbmt3SFkwaGtiUkVoV2RHNW5SazFUVWMxZE5hbEY2V2FibQ==";
const verificationKey = "WVVkR2IxbFRRakZKUjNoMllqSjBiRnBCUFQwPQ==";

window.addEventListener("DOMContentLoaded", () => {
    Installer.fs = fs;

    const verification = document.getElementById("verification");
    const verificationAttached = document.getElementById("verification_attached");
    verificationAttached.innerHTML = "ATTACHED";
    if (verification) {
        if (verification.innerText.trim() === loadingScreenKey) {
            // we are on the loading screen
            const spinner = document.getElementById("spinner");
            const status = document.getElementById("status");
            const logs = document.getElementById("logs");
            const refresh = document.getElementById("refresh");
            const copy = document.getElementById("copy");

            refresh.onclick = () => {
                location.reload();
            };
            copy.onclick = () => {
                const copyable = Installer.logs.join('\n');
                navigator.clipboard.writeText(copyable);
            };

            status.innerHTML = "Please wait...";
            // just makes sure the folder isnt empty
            fs.readFile("./penguinmod/compilation/verification.txt", "utf8", async (err, data) => {
                if (err || data !== verificationKey) {
                    console.log(err);
                    // reinstall
                    status.innerHTML = "Installing PenguinMod, this may take a bit...";
                    logs.style = "";
                    // attach log thing
                    Installer.addLogListener(() => {
                        logs.value = Installer.logs.map(log => ('> ' + log)).join("\n");
                        logs.scrollBy(0, 1073741824); // scroll down
                    });
                    // install
                    try {
                        // TODO: Installer does not have GUI repo installation implemented yet
                        await Installer.install("./penguinmod/compilation");
                    } catch (err) {
                        Installer.log(`ERROR: ${err}${err.stack ? `\n${err.stack}` : ''}`);
                        status.innerHTML = "Installation failed. See below for details.";
                        refresh.style = "";
                        copy.style = "";
                        spinner.style = "display: none;";
                        return;
                    }
                }
                console.log(err, data);
                // the folder exists & can be used
                logs.style = "display: none;";
                status.style = "display: none;";
                spinner.style = "display: none;";
                document.body.innerHTML = '';
                document.body.style.background = `linear-gradient(180deg, rgba(0,194,254,1) 0%, rgba(0,145,227,1) 100%)`;
                document.body.style.overflow = "hidden";
                const imageContainer = document.body.appendChild(document.createElement("div"));
                imageContainer.style = "width: 100%;"
                    + "height: 100%; display: flex; flex-direction: column;"
                    + "align-items: center; justify-content: center;"
                    + "position: absolute; left: 0; top: 0; user-select: none;";
                const image = imageContainer.appendChild(document.createElement("img"));
                image.src = "gradient_logo.png";
                image.style = "height: 45%; user-select: none;"
                    + "position: relative; animation-name: bouncing;"
                    + "animation-fill-mode: forwards;"
                    + "animation-iteration-count: infinite;"
                    + "animation-duration: 1s;"
                    + "animation-delay: 0s;";
                image.draggable = false;
                // ok lets actually launch now
                console.log('Attempting to launch');
                // TODO: we should start on a port that is not 5173 (should be exclusive to launcher so not 5174 either)
                //       api needs to be able to handle that btw
                const runningPort = 54642;
                const queryIntervalUrl = `http://localhost:${runningPort}/favicon.png`;
                console.log('running');
                ipcRenderer.invoke('beginHomeProcess');
                // continously try to access a file until it succeeds (this is because running as dev never exits)
                console.log('beginning query interval...');
                await localResourceAvailable(queryIntervalUrl, 1000);
                console.log('found');
                ipcRenderer.invoke('goToHome');
            });
        }
    }
});