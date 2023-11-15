const checkArgs = require('./utils/checkArgs');
const {access, readFile, writeFile, mkdir} = require('fs/promises');
const {resolve} = require('path');
const readline = require('node:readline');

async function writeToFile(path, outputData) {
    return readFile(path).then((data) => outputData(data)).then((output) => writeFile(path, output));
}

const rl = readline.createInterface({input: process.stdin, output: process.stdout});
const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));
const REACTOR_API_URL = 'https://reactor.adobe.io/';
const ADOBE_OAUTH_URL = 'https://ims-na1.adobelogin.com/ims/token/v3'; // Replace with the actual default OAuth URL

async function tryToValidateSettings(args, path) {
    try {
        checkArgs(args);
    } catch (e) {
        if (e.message.includes('Launch Sync settings')) {
            await writeFile(path, '{}');
        } else {
            // Handle both reactorUrl and oauth in one place to avoid repetition
            await writeToFile(path, async (input) => {
                const current = JSON.parse(input) || {};
                current['environment'] = current['environment'] || {};

                if (e.message.includes('"environment"') || e.message.includes('"environment.reactorUrl')) {
                    const reactorUrl = await prompt(`Reactor API Url (Default: ${REACTOR_API_URL}): `);
                    current['environment']['reactorUrl'] = reactorUrl === '' ? REACTOR_API_URL : reactorUrl;
                }

                if (e.message.includes('"environment"') || e.message.includes('"environment.oauth')) {
                    const oauthUrl = await prompt(`OAuth Url (Default: ${ADOBE_OAUTH_URL}): `);
                    current['environment']['oauth'] = oauthUrl === '' ? ADOBE_OAUTH_URL : oauthUrl;
                }

                return JSON.stringify(current);
            });
        }
        return tryToValidateSettings(args, path);
    }
}


async function initializeProperty(path) {
    // Function to prompt and validate required settings
    const promptForRequiredSetting = async (settingName) => {
        const value = await prompt(`${settingName}: `);
        if (!value) {
            throw new Error(`${settingName} is required`);
        }
        return value;
    };

    // Prompting for required settings
    const accessToken = await promptForRequiredSetting('Access Token');
    const clientId = await promptForRequiredSetting('Client ID');
    const clientSecret = await promptForRequiredSetting('Client Secret');
    const propertyId = await promptForRequiredSetting('Launch Property ID');

    // Create property directory and subdirectories
    const propertyPath = resolve(process.cwd(), propertyId);
    const directories = ['data_elements', 'environments', 'extensions', 'rule_components', 'rules'];

    // Ensure all directories exist, including the property directory
    await mkdir(propertyPath, {recursive: true});
    await Promise.all(directories.map(dir => mkdir(resolve(propertyPath, dir), {recursive: true})));

    console.log('Directories created & .reactor-settings.json created. Ready to sync.');

    // Update and write settings to the file
    return writeToFile(path, (input) => {
        const current = JSON.parse(input) || {};
        Object.assign(current, {
            propertyId: propertyId,
            accessToken: accessToken,
            integration: {clientId, clientSecret}
        });
        return JSON.stringify(current, null, 2); // formatted JSON for readability
    });
}


module.exports = async (args) => {
    const oldConsoleError = console.error;
    // temporary overwrite
    console.error = (e) => {
        throw new Error(e);
    };
    const path = args.settings === undefined ? resolve(process.cwd(), '.reactor-settings.json') : args.settings;
    return tryToValidateSettings(args, path)
        .then(() => initializeProperty(path))
        .finally(() => {
            console.error = oldConsoleError;
            rl.close();
        });
};
