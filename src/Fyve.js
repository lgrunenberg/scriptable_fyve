// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;


/*****************
Version 1.0.0


If you have problems or need help, please ask for support here:
https://github.com/lgrunenberg/scriptable_fyve


Heavily based on
https://github.com/BergenSoft/scriptable_premiumsim
*/



// ************************
// * CUSTOM CONFIGURATION *
// ************************
// How many minutes should the cache be used
let m_CacheMinutes = 60 * 4;

// Styles
const m_CanvSize = 200;
const m_CanvTextSize = 16;

const m_CanvFillColorMonth = '#EDEDED';
const m_CanvFillColorDataGood = '#1AE01A';
const m_CanvFillColorDataOK = '#E0E01A';
const m_CanvFillColorDataBad = '#E01A1A';
const m_CanvStrokeColor = '#121212'; // Circles background color
const m_CanvBackColor = '#242424'; // Widget background color
const m_CanvTextColor = '#FFFFFF'; // Text color (use same color as above to hide text)

// Dimensions of the circles
const m_CanvWidth = 9;
const m_CanvRadiusMonth = 80;
const m_CanvRadiusData = 70;


// ********************
// * GLOBAL VARIABLES *
// ********************

// Used to draw the circles
const m_Canvas = new DrawContext();
const m_forceReload = false;

// For processing the requests
let m_Token = null;

// Usage data
let m_Data = {
    bytes: 0,
    percent: 0,
    total: 0,
    expirationDate: ""
};

// Set up the file manager.
const m_Filemanager = initFileManager();

// Set up cache
const m_ConfigRoot = m_Filemanager.joinPath(m_Filemanager.documentsDirectory(), Script.name());
const m_CachePath = m_Filemanager.joinPath(m_ConfigRoot, "cache.json");
console.log("Cache Path: " + m_CachePath);
const m_CacheExists = m_Filemanager.fileExists(m_CachePath)
const m_CacheDate = m_CacheExists ? m_Filemanager.modificationDate(m_CachePath) : 0

// Set up config
const m_ConfigFile = m_Filemanager.joinPath(m_ConfigRoot, "config.json");
if (!m_Filemanager.fileExists(m_ConfigFile)) {
    let alertBox = new Alert();
    alertBox.title = "Zugangsdaten";
    alertBox.message = "Bitte die Zugangsdaten eingeben.\nDie Daten werden standardmäßig in der iCloud abgespeichert.";
    alertBox.addAction("Speichern");
    alertBox.addCancelAction("Abbrechen");
    alertBox.addTextField("Benutzername");
    alertBox.addSecureTextField("Passwort");
    let pressed = await alertBox.present();

    if (pressed === 0) // Save
    {
        const obj = {
            username: alertBox.textFieldValue(0),
            password: alertBox.textFieldValue(1),
        };
        m_Filemanager.writeString(m_ConfigFile, JSON.stringify(obj));
        await m_Filemanager.downloadFileFromiCloud(m_ConfigFile);
    } else {
        throw new Error("No configuration found");
    }
} else {
    await m_Filemanager.downloadFileFromiCloud(m_ConfigFile);
}

console.log("Config Path: " + m_ConfigFile);

// Retrieve credentials
const config = JSON.parse(await m_Filemanager.readString(m_ConfigFile));
if (config === null) {
    throw new Error("Failed to load configuration. Please delete or correct the file and run the script again.");
}

try {
    // Reload data if script is running within scriptable app
    if (!config.runsInWidget || !m_CacheExists || (m_Today.getTime() - m_CacheDate.getTime()) > (m_CacheMinutes * 60 * 1000) || !loadDataFromCache()) {
        // Load from website
        await getToken();

        await getDataUsage();
        saveDataToCache();


    }
} catch (e) {
    console.error(e);
    // Could not load from website, so load from cache
    loadDataFromCache();
}

// Used for comparing caching date and to calculate month progress
const m_Today = new Date();
const m_MonthEnd = new Date(m_Data.expirationDate);
const m_MonthStart = new Date(m_Data.expirationDate);
m_MonthStart.setDate(m_MonthStart.getDate() - 30);


await createWidget();
Script.complete();

async function getToken() {
    let req = new Request('https://api.shop.fyve.de/api/token');
    req.method = 'POST';
    req.headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
        'Connection': 'keep-alive',
        'X-Transaction': 'Auth-112e24ce-anonymous'
    };
    let body_data = {
        "grant_type": "password",
        "client_id": "fyve",
        "client_secret": "fyve",
        "username": config.username,
        "password": config.password
    };

    req.body = JSON.stringify(body_data);

    let resp_data = await req.loadJSON();

    m_Token = resp_data.access_token;
    console.log(m_Token);
    if (req.response.statusCode != 200) {
        throw new Error("Error getting token!");
    }

    return req.response.statusCode;
}

async function getDataUsage() {


    let authorization = 'Bearer ' + m_Token;
    let body_data = {
        "operationName": "bookedTariff",
        "variables": {},
        "query": `query bookedTariff {
		      consumptions {
		        consumptionsForTariffAndOptions {
				  consumptions {
				    consumed
					expirationDate
					left
					max
					tariffOrOptions {
					  id
					  isFlat
					  name
					  type
					  __typename
					}
					type
					unit
					__typename
				  }
				  id
				  isFlat
				  name
				  type
				  __typename
			    }
			    __typename
		      }
	        }`
    };
    let req = new Request('https://api.shop.fyve.de/api/graphql');
    req.method = 'POST';
    req.headers = {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
        'Connection': 'keep-alive',
        'Authorization': authorization
    };

    req.body = JSON.stringify(body_data);

    let resp = await req.loadJSON();

    let consumptions = resp.data.consumptions.consumptionsForTariffAndOptions;

    let dataUsageBytes = 0;
    let dataInclusive = 0;
    let expirationDate = "";

    consumptions.forEach((tariffConsumption) => {
        dataUsageBytes += tariffConsumption.consumptions[0].consumed * 1024 * 1024 * 1024;
        dataInclusive += tariffConsumption.consumptions[0].max;
        if (tariffConsumption.type === "Tariff") {
            expirationDate = tariffConsumption.consumptions[0].expirationDate;
        }
    });


    let dataUsagePercent = Math.round(dataUsageBytes / (dataInclusive * 1024 * 1024 * 1024) * 1000) / 10; // round to 1 decimal place


    m_Data.bytes = dataUsageBytes;
    m_Data.percent = dataUsagePercent;
    m_Data.total = dataInclusive;
    m_Data.expirationDate = expirationDate;

    console.log(m_Data.total + " GB");
    console.log(dataUsageBytes);
    console.log(dataUsagePercent);
    console.log(expirationDate);
    return;

}


function initFileManager() {
    fileManager = FileManager.iCloud();
    path = fileManager.joinPath(fileManager.documentsDirectory(), Script.name());

    if (!fileManager.isDirectory(path))
        fileManager.createDirectory(path);

    return fileManager;
}


function saveDataToCache() {
    try {
        m_Filemanager.writeString(m_CachePath, JSON.stringify(m_Data))
        return true;
    } catch (e) {
        console.warn("Could not create the cache file.")
        console.warn(e)
        return false;
    }
}

function loadDataFromCache() {
    try {
        m_Data = JSON.parse(m_Filemanager.readString(m_CachePath));
        return true;
    } catch (e) {
        console.warn("Could not load the cache file.")
        console.warn(e)
        return false;
    }
}

async function createWidget() {
    console.log("create widget");
    const wig = new ListWidget();

    m_Canvas.size = new Size(m_CanvSize, m_CanvSize);
    m_Canvas.respectScreenScale = true;

    let bgc = new Rect(0, 0, m_CanvSize, m_CanvSize);
    m_Canvas.setFillColor(new Color(m_CanvBackColor));
    m_Canvas.fill(bgc);

    const percentMonth = (m_Today.getTime() - m_MonthStart.getTime()) / (m_MonthEnd.getTime() - m_MonthStart.getTime());
    const fillColorData = (m_Data.percent / 100 <= percentMonth) ? m_CanvFillColorDataGood : ((m_Data.percent / 100 / 1.1 <= percentMonth) ? m_CanvFillColorDataOK : m_CanvFillColorDataBad);


    drawArc(
        new Point(m_CanvSize / 2, m_CanvSize / 2),
        m_CanvRadiusMonth,
        m_CanvWidth,
        percentMonth * 100 * 3.6,
        m_CanvFillColorMonth
    );
    drawArc(
        new Point(m_CanvSize / 2, m_CanvSize / 2),
        m_CanvRadiusData,
        m_CanvWidth,
        m_Data.percent * 3.6,
        fillColorData
    );

    const canvTextRectBytes = new Rect(
        0,
        m_CanvSize / 2 - m_CanvTextSize,
        m_CanvSize,
        m_CanvTextSize * 2
    );
    const canvTextRectPercent = new Rect(
        0,
        m_CanvSize / 2,
        m_CanvSize,
        m_CanvTextSize * 2
    );
    m_Canvas.setTextAlignedCenter();
    m_Canvas.setTextColor(new Color(m_CanvTextColor));
    m_Canvas.setFont(Font.boldSystemFont(m_CanvTextSize));
    if (m_Data.bytes < 100 * 1024 * 1024) // < 100 MB
    {
        m_Canvas.drawTextInRect(`${(m_Data.bytes / 1024 / 1024).toFixed(0)} MB / ${m_Data.total} GB`, canvTextRectBytes);
    } else if (m_Data.bytes < 1024 * 1024 * 1024) // < 1 GB
    {
        m_Canvas.drawTextInRect(`${(m_Data.bytes / 1024 / 1024 / 1024).toFixed(2)} GB / ${m_Data.total} GB`, canvTextRectBytes);
    } else {
        m_Canvas.drawTextInRect(`${(m_Data.bytes / 1024 / 1024 / 1024).toFixed(1)} GB / ${m_Data.total} GB`, canvTextRectBytes);
    }
    m_Canvas.drawTextInRect(`${m_Data.percent} %`, canvTextRectPercent);

    const canvImage = m_Canvas.getImage();
    wig.backgroundImage = canvImage;
    Script.setWidget(wig);
    Script.complete();
    await wig.presentSmall();
}


function sinDeg(deg) {
    return Math.sin((deg * Math.PI) / 180);
}

function cosDeg(deg) {
    return Math.cos((deg * Math.PI) / 180);
}

function drawArc(ctr, rad, w, deg, fillColor) {
    let bgx = ctr.x - rad;
    let bgy = ctr.y - rad;
    let bgd = 2 * rad;
    let bgr = new Rect(bgx, bgy, bgd, bgd);

    m_Canvas.setFillColor(new Color(fillColor));
    m_Canvas.setStrokeColor(new Color(m_CanvStrokeColor));
    m_Canvas.setLineWidth(w);
    m_Canvas.strokeEllipse(bgr);

    for (t = 0; t < deg; t++) {
        rect_x = ctr.x + rad * sinDeg(t) - w / 2;
        rect_y = ctr.y - rad * cosDeg(t) - w / 2;
        rect_r = new Rect(rect_x, rect_y, w, w);
        m_Canvas.fillEllipse(rect_r);
    }
}
