"use strict";

// Use visitor's preferred locale for formatting
let userLocale = (navigator.language || (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().locale) || 'en-US');
// Container for externally loaded feeds.json
let feedsData = null;
// Default network timeout (ms)
const DEFAULT_FETCH_TIMEOUT = 10000;

// Helper: validate URL and ensure it's https
function isValidHttpsUrl(input) {
    try {
        const u = new URL(input);
        return (u.protocol === 'https:');
    } catch (e) { return false; }
}

// Helper: fetch with timeout using AbortController
async function fetchWithTimeout(resource, options = {}, timeout = DEFAULT_FETCH_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}
// Built-in fallback (used when feeds.json cannot be loaded, e.g. file:// or CORS blocked).
// Contains the same per-country coverage as feeds.json so dev-mode works offline.
const defaultFeeds = {
    "NO": [
        { "url": "https://www.nrk.no/nyheter/siste.rss", "label": "NRK" },
        { "url": "https://www.tv2.no/rss/nyheter", "label": "TV2" }
    ],
    "SE": [
        { "url": "https://www.svt.se/nyheter/rss.xml", "label": "SVT" },
        { "url": "https://www.dn.se/m/rss/", "label": "DN" },
        { "url": "https://www.aftonbladet.se/rss.xml", "label": "AFTONB" }
    ],
    "FI": [
        { "url": "https://yle.fi/uutiset/rss/p%C3%A4%C3%A4uutiset", "label": "YLE" },
        { "url": "https://www.hs.fi/rss/", "label": "HS" }
    ],
    "FR": [
        { "url": "https://www.france24.com/fr/rss", "label": "FRANCE24" },
        { "url": "https://www.lemonde.fr/rss/une.xml", "label": "LEMONDE" },
        { "url": "https://rss.lefigaro.fr/lefigaro/laune", "label": "LEFIGARO" }
    ],
    "US": [
        { "url": "https://rss.cnn.com/rss/edition.rss", "label": "CNN" },
        { "url": "https://feeds.npr.org/1001/rss.xml", "label": "NPR" },
        { "url": "https://www.nytimes.com/services/xml/rss/nyt/HomePage.xml", "label": "NYTIMES" },
        { "url": "https://feeds.washingtonpost.com/rss/world", "label": "WPOST" }
    ],
    "GB": [
        { "url": "https://feeds.bbci.co.uk/news/rss.xml", "label": "BBC" },
        { "url": "https://www.theguardian.com/world/rss", "label": "GUARDIAN" },
        { "url": "https://feeds.skynews.com/feeds/rss/home.xml", "label": "SKY" }
    ],
    "DE": [
        { "url": "https://www.spiegel.de/international/index.rss", "label": "SPIEGEL" },
        { "url": "https://www.tagesschau.de/xml/rss2", "label": "TAGESSCHAU" },
        { "url": "https://www.faz.net/rss/aktuell/", "label": "FAZ" }
    ],
    "ES": [
        { "url": "https://feeds.elpais.com/rss/elpais/portada", "label": "ELPAIS" },
        { "url": "https://www.elmundo.es/rss/espana.xml", "label": "ELMUNDO" }
    ],
    "IT": [
        { "url": "https://www.ansa.it/sito/ansait_rss.xml", "label": "ANSA" },
        { "url": "https://www.repubblica.it/rss/homepage/rss2.0.xml", "label": "REPUBBLICA" }
    ],
    "NL": [
        { "url": "https://www.nu.nl/rss/Algemeen", "label": "NU" },
        { "url": "https://feeds.nos.nl/nosnieuwsalgemeen?format=xml", "label": "NOS" }
    ],
    "AU": [
        { "url": "https://www.abc.net.au/news/feed/51120/rss.xml", "label": "ABC" },
        { "url": "https://www.smh.com.au/rss/feed.xml", "label": "SMH" }
    ],
    "CA": [
        { "url": "https://rss.cbc.ca/lineup/topstories.xml", "label": "CBC" },
        { "url": "https://www.theglobeandmail.com/beta/rss/home.xml", "label": "GLOBE" }
    ],
    "JP": [
        { "url": "https://www3.nhk.or.jp/rss/news/cat0.xml", "label": "NHK" }
    ],
    "BR": [
        { "url": "https://g1.globo.com/rss/g1/", "label": "G1" }
    ],
    "IN": [
        { "url": "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", "label": "TIMES" }
    ],
    "MX": [
        { "url": "https://www.eluniversal.com.mx/rss/ultima-hora.xml", "label": "ELUNIVERSAL" }
    ],
    "DEFAULT": [
        { "url": "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", "label": "GOOGLE" }
    ]
};

// Interval handles for controllable features
let marketInterval = null;
let localInterval = null;
let globalInterval = null;

/**
 * Arkitektonisk rendering av tekstrekker.
 * Splitter tekst i spans for å tillate perfekt justify-content: space-between i CSS.
 */
function renderRow(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    text.split('').forEach(char => {
        const span = document.createElement('span');
        span.textContent = char;
        el.appendChild(span);
    });
}

/**
 * Henter live børsdata (Wall Street Ticker).
 * Bruker Binance API for sanntids krypto og har fallback for indekser.
 */
async function fetchMarketData() {
    const track = document.getElementById('market-track');
    try {
        // Henter krypto som fungerer uten CORS-problemer
        const res = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT"]');
        const data = await res.json();
        
        const btc = data.find(x => x.symbol === "BTCUSDT");
        const eth = data.find(x => x.symbol === "ETHUSDT");

        // Kombinerer ekte krypto med simulerte markedsindekser for helhetlig look
        // Determine visitor country to show a relevant FX pair (USD/<local>)
        const countryCode = await getUserCountryCode();
        const currencyByCountry = {
            'NO': 'NOK','SE':'SEK','FI':'EUR','FR':'EUR','DE':'EUR','ES':'EUR','IT':'EUR',
            'GB':'GBP','US':'USD','AU':'AUD','CA':'CAD','JP':'JPY','IN':'INR','BR':'BRL','MX':'MXN','NL':'EUR'
        };
        const localCurrency = currencyByCountry[countryCode] || 'USD';

        // Try to get a live USD->LOCAL rate from exchangerate.host (CORS-friendly)
        let fxLabel = `USD/${localCurrency}`;
        let fxPrice = '—';
        let fxChg = '+0.00%';
        try {
            if (localCurrency && localCurrency !== 'USD') {
                const fxRes = await fetchWithTimeout(`https://api.exchangerate.host/latest?base=USD&symbols=${localCurrency}`);
                const fxData = await fxRes.json();
                if (fxData && fxData.rates && fxData.rates[localCurrency]) {
                    fxPrice = parseFloat(fxData.rates[localCurrency]).toFixed(2).toLocaleString ? parseFloat(fxData.rates[localCurrency]).toFixed(2) : parseFloat(fxData.rates[localCurrency]).toFixed(2);
                    // small simulated percent change (visual only)
                    const rand = (Math.random() * 0.6 - 0.3).toFixed(2);
                    fxChg = (rand >= 0 ? '+' : '') + rand + '%';
                }
            } else {
                // Local currency is USD: show USD index-like value
                fxLabel = 'USD'; fxPrice = '1.00'; fxChg = '+0.00%';
            }
        } catch (e) { console.warn('FX lookup failed', e); fxPrice = '10.58'; fxChg = '-0.12%'; }

        const markets = [
            { name: 'BTC', price: parseFloat(btc.lastPrice).toLocaleString(), chg: parseFloat(btc.priceChangePercent).toFixed(2) + '%' },
            { name: 'ETH', price: parseFloat(eth.lastPrice).toLocaleString(), chg: parseFloat(eth.priceChangePercent).toFixed(2) + '%' },
            { name: 'OSEBX', price: '1,245.20', chg: '+0.32%' },
            { name: 'NASDAQ', price: '16,210', chg: '+1.12%' },
            { name: 'S&P 500', price: '5,120', chg: '+0.15%' },
            { name: fxLabel, price: fxPrice, chg: fxChg },
            { name: 'BRENT OIL', price: '82.45', chg: '+0.45%' },
            { name: 'GOLD', price: '2,155', chg: '+0.25%' }
        ];

        // Build DOM safely
        while (track.firstChild) track.removeChild(track.firstChild);
        const fragment = document.createDocumentFragment();
        const makeItem = (m) => {
            const div = document.createElement('div');
            div.className = 'market-item';
            const span = document.createElement('span'); span.textContent = m.name;
            const strong = document.createElement('strong'); strong.textContent = m.price;
            const small = document.createElement('small'); small.className = (m.chg && m.chg.startsWith('+')) ? 'up' : 'down'; small.textContent = `${(m.chg && m.chg.startsWith('+')) ? '▲' : '▼'} ${m.chg}`;
            div.appendChild(span); div.appendChild(strong); div.appendChild(small);
            return div;
        };
        markets.forEach(m => fragment.appendChild(makeItem(m)));
        // duplicate for looping effect
        const frag2 = fragment.cloneNode(true);
        track.appendChild(fragment);
        track.appendChild(frag2);

    } catch (e) {
        console.warn("Market API treg eller blokkert. Bruker fallback.");
        // safe fallback DOM
        while (track.firstChild) track.removeChild(track.firstChild);
        const fallbackDiv = document.createElement('div'); fallbackDiv.className = 'market-item';
        const sp = document.createElement('span'); sp.textContent = 'MARKETS LIVE';
        const st = document.createElement('strong'); st.textContent = 'SYNCING...';
        fallbackDiv.appendChild(sp); fallbackDiv.appendChild(st);
        track.appendChild(fallbackDiv);
    }
}

/**
 * Henter lokale nyheter basert på region (NRK/TV2 for Norge).
 */
async function fetchLocalNews() {
    const localContent = document.getElementById('local-content');
    let countryCode = 'DEFAULT';

    // immediate feedback
    if (localContent) { while (localContent.firstChild) localContent.removeChild(localContent.firstChild); const s = document.createElement('span'); s.textContent = 'LOADING LOCAL...'; localContent.appendChild(s); }

    // Perform geo lookup only if user has given consent.
    const consent = (function(){ try { return localStorage.getItem('consent'); } catch(e){ return null; } })();
    if (consent === 'accepted') {
        try {
            const geoResp = await fetchWithTimeout('https://ipapi.co/json/');
            const geo = await geoResp.json();
            countryCode = geo.country_code || 'NO';
        } catch(e) { console.log("Geo lookup blocked"); }
    } else {
        // No consent => derive region from several locale sources (privacy-friendly)
        const tryRegion = () => {
            try {
                // 1. userLocale (navigator.language)
                if (userLocale && userLocale.includes('-')) return userLocale.split('-')[1].toUpperCase();
                // 2. Intl resolved locale
                const r2 = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions && Intl.DateTimeFormat().resolvedOptions().locale) || '';
                if (r2 && r2.includes('-')) return r2.split('-')[1].toUpperCase();
                // 3. navigator.languages array
                if (navigator.languages && navigator.languages.length) {
                    for (const l of navigator.languages) {
                        if (l && l.includes('-')) return l.split('-')[1].toUpperCase();
                    }
                }
            } catch (e) { /* ignore */ }
            return null;
        };
        const region = tryRegion();
        countryCode = region || 'DEFAULT';
        console.log('Local news region (consent declined):', region, '-> using', countryCode);
    }

    // Use feeds loaded from feeds.json (if available). Entries can be strings or objects {url,label}.
    const feeds = (feedsData && feedsData.feeds) ? feedsData.feeds : {};
    const entries = feeds[countryCode] || feeds['DEFAULT'] || [];
    let allNews = [];
    const attempted = [];
    for (const entry of entries) {
        const url = (typeof entry === 'string') ? entry : (entry.url || '');
        const mappedLabel = (typeof entry === 'object' && entry.label) ? entry.label : null;
        if (!url) continue;
        attempted.push(url);
        try {
            // First try the rss2json proxy
            let data = null;
                    try {
                    const res = await fetchWithTimeout(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
                    data = await res.json();
            } catch (e) {
                console.warn('rss2json proxy failed for', url, e);
                data = null;
            }

            if (data && Array.isArray(data.items) && data.items.length) {
                let label = mappedLabel;
                if (!label) {
                    if (data.feed && data.feed.title) {
                        const t = data.feed.title.toUpperCase();
                        const known = t.match(/(NRK|TV2|SVT|YLE|FRANCE24|FRANCE|VG|BBC|CNN)/);
                        if (known && known[0]) label = known[0];
                        else {
                            const first = t.split(/\s+/)[0];
                            if (!/^(SISTE|NYHETER|SENESTE|LATEST|NEWS)$/i.test(first)) label = first;
                        }
                    }
                }
                if (!label) {
                    try { label = new URL(url).hostname.replace(/^www\./, '').split('.')[0].toUpperCase(); } catch(e) { label = 'NEWS'; }
                }

                data.items.forEach(item => {
                    allNews.push({
                        title: (item.title || '').toUpperCase(),
                        link: item.link,
                        date: new Date(item.pubDate || Date.now()),
                        source: label
                    });
                });
            } else {
                // Fallback: fetch raw XML via AllOrigins and parse locally (helps around CORS/rate limits)
                try {
                    const rawResp = await fetchWithTimeout('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
                    const raw = await rawResp.text();
                    const doc = new DOMParser().parseFromString(raw, 'text/xml');
                    const channel = doc.querySelector('channel');
                    let label = mappedLabel;
                    if (!label && channel) {
                        const ft = channel.querySelector('title');
                        if (ft && ft.textContent) {
                            const t = ft.textContent.toUpperCase();
                            label = t.split(/\s+/)[0];
                        }
                    }
                    if (!label) {
                        try { label = new URL(url).hostname.replace(/^www\./, '').split('.')[0].toUpperCase(); } catch(e) { label = 'NEWS'; }
                    }
                    const items = doc.querySelectorAll('item');
                    items.forEach(item => {
                        const ti = item.querySelector('title') ? item.querySelector('title').textContent : '';
                        const li = item.querySelector('link') ? item.querySelector('link').textContent : (item.querySelector('guid') ? item.querySelector('guid').textContent : '#');
                        const pd = item.querySelector('pubDate') ? new Date(item.querySelector('pubDate').textContent) : new Date();
                        allNews.push({ title: (ti || '').toUpperCase(), link: li, date: pd, source: label });
                    });
                } catch (e) { console.warn('XML fallback failed for', url, e); }
            }
        } catch (e) { console.warn('Feed processing error', url, e); }
    }
    allNews.sort((a, b) => b.date - a.date);
    
    if(allNews.length > 0) {
        // Build safe DOM list of anchors
        while (localContent.firstChild) localContent.removeChild(localContent.firstChild);
        const frag = document.createDocumentFragment();
        allNews.forEach(a => {
            const aEl = document.createElement('a');
            try { aEl.href = isValidHttpsUrl(a.link) ? a.link : '#'; } catch(e){ aEl.href = '#'; }
            aEl.target = '_blank';
            aEl.rel = 'noopener noreferrer';
            aEl.style.color = 'inherit';
            aEl.style.textDecoration = 'none';
            aEl.style.marginRight = '50px';
            const span = document.createElement('span'); span.style.opacity = '0.6'; span.textContent = `[${a.source}] `;
            aEl.appendChild(span);
            const txt = document.createTextNode(' ' + a.title);
            aEl.appendChild(txt);
            frag.appendChild(aEl);
        });
        localContent.appendChild(frag);
    } else {
        // No feeds returned — show attempted sources for debugging and a fallback
        while (localContent.firstChild) localContent.removeChild(localContent.firstChild);
        const s = document.createElement('span'); s.style.opacity = '0.7';
        const hosts = attempted.map(u => {
            try { return new URL(u).hostname; } catch(e) { return u; }
        }).join(', ');
        s.textContent = `NO LOCAL FEED (${countryCode}). Tried: ${hosts}`;
        localContent.appendChild(s);
    }
    }

// Simulation mapping: country -> { locale, timeZone }
const countrySim = {
    'NO': { locale: 'nb-NO', timeZone: 'Europe/Oslo' },
    'SE': { locale: 'sv-SE', timeZone: 'Europe/Stockholm' },
    'FI': { locale: 'fi-FI', timeZone: 'Europe/Helsinki' },
    'FR': { locale: 'fr-FR', timeZone: 'Europe/Paris' },
    'US': { locale: 'en-US', timeZone: 'America/New_York' },
    'GB': { locale: 'en-GB', timeZone: 'Europe/London' },
    'DE': { locale: 'de-DE', timeZone: 'Europe/Berlin' },
    'ES': { locale: 'es-ES', timeZone: 'Europe/Madrid' },
    'IT': { locale: 'it-IT', timeZone: 'Europe/Rome' },
    'NL': { locale: 'nl-NL', timeZone: 'Europe/Amsterdam' },
    'AU': { locale: 'en-AU', timeZone: 'Australia/Sydney' },
    'CA': { locale: 'en-CA', timeZone: 'America/Toronto' },
    'JP': { locale: 'ja-JP', timeZone: 'Asia/Tokyo' },
    'BR': { locale: 'pt-BR', timeZone: 'America/Sao_Paulo' },
    'IN': { locale: 'en-IN', timeZone: 'Asia/Kolkata' },
    'DEFAULT': { locale: userLocale, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
};

/**
 * Resolve a user's country code.
 * If consent accepted, prefer IP-based lookup; otherwise derive from locale hints.
 */
async function getUserCountryCode() {
    // Try consent-based IP lookup first
    const consent = (function(){ try { return localStorage.getItem('consent'); } catch(e){ return null; } })();
    if (consent === 'accepted') {
        try {
            try {
            const geoResp = await fetchWithTimeout('https://ipapi.co/json/');
            const geo = await geoResp.json();
            if (geo && geo.country_code) return geo.country_code.toUpperCase();
            } catch(e) { console.warn('Geo lookup failed', e); }
        } catch (e) { console.warn('Geo lookup failed', e); }
    }

    // Privacy-friendly locale-derived fallback (non-identifying)
    try {
        if (userLocale && userLocale.includes('-')) return userLocale.split('-')[1].toUpperCase();
        const r2 = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions && Intl.DateTimeFormat().resolvedOptions().locale) || '';
        if (r2 && r2.includes('-')) return r2.split('-')[1].toUpperCase();
        if (navigator.languages && navigator.languages.length) {
            for (const l of navigator.languages) if (l && l.includes('-')) return l.split('-')[1].toUpperCase();
        }
    } catch (e) {}
    return 'US';
}

/**
 * Build the HTML content for the Sources modal from loaded feeds.
 */
function buildSourcesContent() {
    const container = document.getElementById('sources-content');
    if (!container) return;
    const feeds = (feedsData && feedsData.feeds) ? feedsData.feeds : defaultFeeds;
    const countryNames = {
        'NO': 'Norway','SE':'Sweden','FI':'Finland','FR':'France','US':'United States','GB':'United Kingdom',
        'DE':'Germany','ES':'Spain','IT':'Italy','NL':'Netherlands','AU':'Australia','CA':'Canada','JP':'Japan',
        'BR':'Brazil','IN':'India','MX':'Mexico','DEFAULT':'Default'
    };
    const countryKeys = Object.keys(feeds).sort((a,b) => {
        const nameA = (countryNames[a] || a).toUpperCase();
        const nameB = (countryNames[b] || b).toUpperCase();
        return nameA.localeCompare(nameB);
    });
    // clear and build DOM
    while (container.firstChild) container.removeChild(container.firstChild);
    const wrapper = document.createElement('div');
    wrapper.style.maxHeight = '60vh'; wrapper.style.overflow = 'auto'; wrapper.style.paddingRight = '8px';
    countryKeys.forEach(cc => {
        const displayName = countryNames[cc] || cc;
        const h3 = document.createElement('h3'); h3.style.margin = '10px 0 6px';
        h3.textContent = displayName + ' ';
        const small = document.createElement('small'); small.style.opacity = '0.6'; small.style.marginLeft = '8px'; small.textContent = cc;
        h3.appendChild(small);
        wrapper.appendChild(h3);
        const ul = document.createElement('ul'); ul.style.margin = '0 0 8px 18px';
        const entries = Array.isArray(feeds[cc]) ? feeds[cc].slice() : [];
        entries.sort((x,y) => ((x.label||'').localeCompare(y.label||'')));
        entries.forEach(e => {
            const li = document.createElement('li'); li.style.marginBottom = '6px';
            const url = (typeof e === 'string') ? e : (e.url || '#');
            const label = (typeof e === 'object' && e.label) ? e.label : (url ? (() => { try { return new URL(url).hostname; } catch(e){ return url; } })() : 'UNKNOWN');
            const a = document.createElement('a');
            try { a.href = isValidHttpsUrl(url) ? url : '#'; } catch(e){ a.href = '#'; }
            a.target = '_blank'; a.rel = 'noopener noreferrer';
            a.textContent = label;
            const divUrl = document.createElement('div'); divUrl.style.opacity = '0.7'; divUrl.style.fontSize = '0.85rem'; divUrl.textContent = url;
            li.appendChild(a); li.appendChild(divUrl); ul.appendChild(li);
        });
        wrapper.appendChild(ul);
    });
    container.appendChild(wrapper);
}

/**
 * Render ad slot only when user consented. Placeholder for future ad integration.
 */
function renderAdSlot() {
    const slot = document.getElementById('ad-slot');
    if (!slot) return;
    try {
        const consent = (function(){ try { return localStorage.getItem('consent'); } catch(e){ return null; } })();
        while (slot.firstChild) slot.removeChild(slot.firstChild);
        if (consent === 'accepted') {
            slot.setAttribute('aria-hidden','false');
            // Placeholder content; replace with ad provider script insertion after publishing.
            const p = document.createElement('div');
            p.textContent = 'Ad placeholder — ads load only after consent. (Prepare AdSense here)';
            slot.appendChild(p);
            // Example: to load Google AdSense dynamically after consent, insert script here.
            // e.g. const s=document.createElement('script'); s.async=true; s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'; document.head.appendChild(s);
        } else {
            slot.setAttribute('aria-hidden','true');
            const p = document.createElement('div'); p.textContent = 'Ads are hidden until you accept region/ads consent.'; p.style.opacity = '0.7'; slot.appendChild(p);
        }
    } catch (e) { console.warn('Ad slot render failed', e); }
}

/**
 * Load feeds.json (externalized feed configuration). Falls back to empty feeds object.
 */
async function loadFeeds() {
    try {
        const res = await fetchWithTimeout('feeds.json');
        if (!res.ok) throw new Error('feeds.json not found');
        feedsData = await res.json();
        console.log('feeds.json loaded');
    } catch (e) {
        console.warn('Could not load feeds.json, falling back to built-in feeds (file:// or CORS may block fetch)', e);
        feedsData = { feeds: defaultFeeds };
    }
}

// Feature control helpers
function startMarket() {
    const el = document.getElementById('market-cards-container');
    if (el) el.style.display = '';
    fetchMarketData();
    if (marketInterval) clearInterval(marketInterval);
    marketInterval = setInterval(fetchMarketData, 60000);
}
function stopMarket() {
    if (marketInterval) { clearInterval(marketInterval); marketInterval = null; }
    const el = document.getElementById('market-cards-container');
    if (el) el.style.display = 'none';
}

function startLocal() {
    const el = document.getElementById('local-news-area');
    if (el) el.style.display = '';
    fetchLocalNews();
    if (localInterval) clearInterval(localInterval);
    localInterval = setInterval(fetchLocalNews, 300000);
}
function stopLocal() {
    if (localInterval) { clearInterval(localInterval); localInterval = null; }
    const el = document.getElementById('local-news-area');
    if (el) el.style.display = 'none';
}

function startGlobal() {
    // start polling global news and ensure hot/news blocks are visible
    const hot = document.getElementById('hot-news-area');
    const news = document.getElementById('news-marquee');
    if (hot) hot.style.display = '';
    if (news) news.parentElement.style.display = '';
    fetchGlobalNews();
    if (globalInterval) clearInterval(globalInterval);
    globalInterval = setInterval(fetchGlobalNews, 60000);
}
function stopGlobal() {
    if (globalInterval) { clearInterval(globalInterval); globalInterval = null; }
    const hot = document.getElementById('hot-news-area');
    const news = document.getElementById('news-marquee');
    if (hot) hot.style.display = 'none';
    if (news) news.parentElement.style.display = 'none';
}


/**
 * Henter globale nyheter fra ok.surf API.
 */
async function fetchGlobalNews() {
    try {
        const resp = await fetchWithTimeout('https://ok.surf/api/v1/cors/news-feed');
        const data = await resp.json();
        let hotEls = [];
        let worldEls = [];
        Object.keys(data).forEach(cat => {
            if (Array.isArray(data[cat])) {
                data[cat].forEach(a => {
                    const aEl = document.createElement('a');
                    try { aEl.href = isValidHttpsUrl(a.link) ? a.link : '#'; } catch(e){ aEl.href = '#'; }
                    aEl.target = '_blank'; aEl.rel = 'noopener noreferrer';
                    aEl.style.color = 'inherit'; aEl.style.textDecoration = 'none'; aEl.style.marginRight = '60px';
                    const span = document.createElement('span'); span.style.color = '#FFD700'; span.textContent = `[${a.source ? a.source.toUpperCase() : cat.toUpperCase()}] `;
                    aEl.appendChild(span);
                    aEl.appendChild(document.createTextNode(' ' + (a.title || '').toUpperCase()));
                    worldEls.push(aEl);
                    if (hotEls.length < 12) hotEls.push(aEl.cloneNode(true));
                });
            }
        });
        const hotTarget = document.getElementById('hot-content');
        const newsTarget = document.getElementById('news-content');
        if (hotTarget) {
            while (hotTarget.firstChild) hotTarget.removeChild(hotTarget.firstChild);
            hotEls.forEach(el => hotTarget.appendChild(el));
        }
        if (newsTarget) {
            while (newsTarget.firstChild) newsTarget.removeChild(newsTarget.firstChild);
            worldEls.slice(12,60).forEach(el => newsTarget.appendChild(el));
        }
    } catch (e) { console.log("Global news offline"); }
}

/**
 * Oppdaterer klokken hvert sekund.
 */
function updateClock() {
    const now = new Date();
    // Determine effective locale/time formatting (no manual timezone selection)
    const effectiveLocale = userLocale;

    // Default: local machine timezone + detected userLocale
    const displayDate = now;
    const timeStr = displayDate.toLocaleTimeString(userLocale);
    renderRow('time', timeStr);
    renderRow('day', new Intl.DateTimeFormat(userLocale, { weekday: 'long' }).format(displayDate).toUpperCase());
    const dd = String(displayDate.getDate()).padStart(2, '0');
    const mm = String(displayDate.getMonth() + 1).padStart(2, '0');
    const yyyy = displayDate.getFullYear();
    renderRow('date', `${dd}.${mm}.${yyyy}`);
    const ampmEl = document.getElementById('ampm-display');
    const ampmMatch = timeStr.match(/\b(AM|PM|am|pm)\b/);
    ampmEl.textContent = ampmMatch ? ampmMatch[0].toUpperCase() : '';
}

/**
 * Initialiserer applikasjonen.
 */
async function init() {
    const tzS = document.getElementById('set-tz');
    if (tzS) {
        // build options safely
        const optLocal = document.createElement('option'); optLocal.value = 'local'; optLocal.textContent = 'LOCAL TIME'; tzS.appendChild(optLocal);
        for (let i = -12; i <= 14; i++) {
            const o = document.createElement('option'); o.value = String(i); o.textContent = `UTC ${i >= 0 ? '+' : ''}${i}`; tzS.appendChild(o);
        }
    }

    document.getElementById('toolbox-toggle').onclick = () => document.getElementById('toolbox').classList.add('open');
    document.getElementById('close-btn').onclick = () => document.getElementById('toolbox').classList.remove('open');
    const modeToggle = document.getElementById('mode-toggle');
    const cubeIcon = document.getElementById('cube-icon');

    // Restore saved theme (if any)
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark') document.body.classList.add('dark-mode');
    } catch (e) { /* ignore storage errors */ }

    // Accessibility
    if (modeToggle) modeToggle.setAttribute('role', 'button');
    if (cubeIcon) cubeIcon.setAttribute('aria-hidden', 'true');

    if (modeToggle) {
        // remove any transient animation classes after they finish
        if (cubeIcon) {
            cubeIcon.addEventListener('animationend', (ev) => {
                if (ev.animationName === 'splash-morph') cubeIcon.classList.remove('splash');
            });

            // mousemove driven CSS vars using movement delta so the droplet
            // morphs in the same direction as the user's drag.
            let lastPos = null;
            let clearTimer = null;
            cubeIcon.addEventListener('mousemove', (e) => {
                if (!lastPos) lastPos = { x: e.clientX, y: e.clientY };
                const movX = e.clientX - lastPos.x;
                const movY = e.clientY - lastPos.y;
                lastPos.x = e.clientX; lastPos.y = e.clientY;

                // amplify movement for visual effect; clamp to avoid extreme values
                const ampX = Math.max(-60, Math.min(60, movX * 4));
                const ampY = Math.max(-40, Math.min(40, movY * 3));

                cubeIcon.style.setProperty('--dx', ampX + 'px');
                cubeIcon.style.setProperty('--dy', ampY + 'px');
                cubeIcon.classList.add('hover-follow');

                if (clearTimer) clearTimeout(clearTimer);
                clearTimer = setTimeout(() => {
                    cubeIcon.style.setProperty('--dx', '0px');
                    cubeIcon.style.setProperty('--dy', '0px');
                    cubeIcon.classList.remove('hover-follow');
                    lastPos = null;
                }, 120);
            });
            cubeIcon.addEventListener('mouseleave', () => {
                cubeIcon.style.setProperty('--dx', '0px');
                cubeIcon.style.setProperty('--dy', '0px');
                cubeIcon.classList.remove('hover-follow');
                lastPos = null;
                if (clearTimer) clearTimeout(clearTimer);
            });
        }

        // Replace click with press/release behavior: pressed visual on mousedown, splash on mouseup
        const setThemeFromInteraction = () => {
            const isDark = document.body.classList.toggle('dark-mode');
            if (cubeIcon) cubeIcon.classList.add('splash');
            try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (e) {}
            modeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
        };

        if (cubeIcon) {
            // visual pressed state
            cubeIcon.addEventListener('mousedown', (e) => {
                cubeIcon.classList.add('pressed');
            });
            // release anywhere on document triggers action if we had pressed
            document.addEventListener('mouseup', (e) => {
                if (cubeIcon.classList.contains('pressed')) {
                    cubeIcon.classList.remove('pressed');
                    setThemeFromInteraction();
                }
            });
            // touch support
            cubeIcon.addEventListener('touchstart', (e) => { cubeIcon.classList.add('pressed'); }, {passive:true});
            cubeIcon.addEventListener('touchend', (e) => { cubeIcon.classList.remove('pressed'); setThemeFromInteraction(); });
        }

        // keyboard accessibility: Enter or Space toggles
        modeToggle.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                setThemeFromInteraction();
            }
        });

        // set initial aria-pressed state
        modeToggle.setAttribute('aria-pressed', document.body.classList.contains('dark-mode') ? 'true' : 'false');
    }

    // Feature toggles
    const toggleMarket = document.getElementById('toggle-market');
    const toggleLocal = document.getElementById('toggle-local');
    const toggleHot = document.getElementById('toggle-hot');
    const toggleNews = document.getElementById('toggle-news');

    if (toggleMarket) toggleMarket.addEventListener('change', (e) => { e.target.checked ? startMarket() : stopMarket(); });
    if (toggleLocal) toggleLocal.addEventListener('change', (e) => { e.target.checked ? startLocal() : stopLocal(); });
    if (toggleHot || toggleNews) {
        const checkGlobal = () => {
            const hotOn = toggleHot ? toggleHot.checked : true;
            const newsOn = toggleNews ? toggleNews.checked : true;
            if (hotOn || newsOn) startGlobal(); else stopGlobal();
            // show/hide specific blocks
            const hotEl = document.getElementById('hot-news-area');
            if (hotEl) hotEl.style.display = (toggleHot && !toggleHot.checked) ? 'none' : '';
            const newsEl = document.getElementById('news-marquee');
            if (newsEl) newsEl.parentElement.style.display = (toggleNews && !toggleNews.checked) ? 'none' : '';
        };
        if (toggleHot) toggleHot.addEventListener('change', checkGlobal);
        if (toggleNews) toggleNews.addEventListener('change', checkGlobal);
    }

    // Privacy modal handlers (in-page; no extra files)
    const privacyLink = document.getElementById('privacy-link');
    const privacyModal = document.getElementById('privacy-modal');
    const privacyClose = document.getElementById('privacy-close');
    const privacyOptout = document.getElementById('privacy-optout');
    const consentSplash = document.getElementById('consent-splash');
    const splashAccept = document.getElementById('splash-accept');
    const splashDecline = document.getElementById('splash-decline');
    const consentBanner = document.getElementById('consent-banner');
    const consentAccept = document.getElementById('consent-accept');
    const consentDecline = document.getElementById('consent-decline');
    const consentPrivacy = document.getElementById('consent-privacy');

    // Consent helpers
    // Only persist consent when explicitly accepted. If declined, clear all visitor-side data
    // so nothing remains stored on the device (best-effort from client-side JS).
    async function clearAllVisitorData() {
        try {
            // Clear storages
            try { localStorage.clear(); } catch(e) {}
            try { sessionStorage.clear(); } catch(e) {}

            // Delete cookies for current origin (best-effort): iterate and expire each
            try {
                const cookies = document.cookie.split(';');
                for (const c of cookies) {
                    const eqPos = c.indexOf('=');
                    const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
                    if (!name) continue;
                    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
                    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + location.hostname + ';';
                }
            } catch (e) { console.warn('Cookie clearing failed', e); }

            // Clear any caches (Service Worker caches)
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
            } catch (e) { console.warn('Cache clearing failed', e); }

            // Unregister service workers (best-effort)
            try {
                if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const r of regs) { try { r.unregister(); } catch(e){} }
                }
            } catch (e) { console.warn('ServiceWorker unregister failed', e); }

            // Remove any dynamically injected ad scripts (convention: data-ad-inserted)
            try {
                const injected = document.querySelectorAll('script[data-ad-inserted], script[data-inserted-by-ad]');
                injected.forEach(s => s.parentElement && s.parentElement.removeChild(s));
            } catch (e) {}

            // stop running intervals and hide features
            try { stopMarket(); stopLocal(); stopGlobal(); } catch(e) {}

            // Reset in-memory feed data to built-in defaults
            try { feedsData = { feeds: defaultFeeds }; } catch(e) {}

        } catch (e) { console.warn('clearAllVisitorData error', e); }
        // Ensure ad slot is hidden
        try { renderAdSlot(); } catch(e) {}
        // Hide the consent banner without persisting the decline
        if (consentBanner) { consentBanner.classList.remove('open'); consentBanner.setAttribute('aria-hidden','true'); }
    }

    function setConsent(val) {
        try {
            if (val === 'accepted') {
                try { localStorage.setItem('consent', 'accepted'); } catch(e) {}
            }
            // If declined, we deliberately do NOT write any persistent flag.
        } catch(e) {}
        if (consentBanner) { consentBanner.classList.remove('open'); consentBanner.setAttribute('aria-hidden','true'); }
    }
    // Hide FEATURES and related UI when the user has declined consent
    function disableFeaturesUI() {
        try {
            const featuresLabel = document.querySelector('#toolbox .drawer-content label');
            const featuresContainer = featuresLabel ? featuresLabel.nextElementSibling : null;
            if (featuresLabel) featuresLabel.style.display = 'none';
            if (featuresContainer) featuresContainer.style.display = 'none';

            // Stop and hide content areas
            const ids = ['market-cards-container','local-news-area','hot-news-area','news-marquee'];
            ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

            // Uncheck toggles and stop intervals
            try { const tMarket=document.getElementById('toggle-market'); if (tMarket) tMarket.checked = false; stopMarket(); } catch(e){}
            try { const tLocal=document.getElementById('toggle-local'); if (tLocal) tLocal.checked = false; stopLocal(); } catch(e){}
            try { const tHot=document.getElementById('toggle-hot'); if (tHot) tHot.checked = false; } catch(e){}
            try { const tNews=document.getElementById('toggle-news'); if (tNews) tNews.checked = false; } catch(e){}
        } catch(e) { console.warn('disableFeaturesUI failed', e); }
    }

    // Restore FEATURES UI (called when consent is accepted)
    function enableFeaturesUI() {
        try {
            const featuresLabel = document.querySelector('#toolbox .drawer-content label');
            const featuresContainer = featuresLabel ? featuresLabel.nextElementSibling : null;
            if (featuresLabel) featuresLabel.style.display = '';
            if (featuresContainer) featuresContainer.style.display = '';

            // Show areas according to toggles
            try { const tMarket=document.getElementById('toggle-market'); if (tMarket && tMarket.checked) startMarket(); }
            catch(e){}
            try { const tLocal=document.getElementById('toggle-local'); if (tLocal && tLocal.checked) startLocal(); }
            catch(e){}
            try {
                const tHot=document.getElementById('toggle-hot'); const tNews=document.getElementById('toggle-news');
                const anyGlobal = (tHot ? tHot.checked : true) || (tNews ? tNews.checked : true);
                if (anyGlobal) startGlobal(); else stopGlobal();
            } catch(e){}
        } catch(e) { console.warn('enableFeaturesUI failed', e); }
    }
    function showConsentBanner() {
        if (!consentBanner) return;
        const existing = (function(){ try{ return localStorage.getItem('consent'); } catch(e){ return null; } })();
        if (!existing) { consentBanner.classList.add('open'); consentBanner.setAttribute('aria-hidden','false'); }
    }
    // wire consent buttons
    if (consentAccept) consentAccept.addEventListener('click', () => { setConsent('accepted'); try { enableFeaturesUI(); fetchLocalNews(); } catch(e){} });
    if (consentDecline) consentDecline.addEventListener('click', () => { try { clearAllVisitorData(); disableFeaturesUI(); } catch(e){} });
    if (consentPrivacy) consentPrivacy.addEventListener('click', (e) => { e.preventDefault(); openPrivacy(); });
    // When consent changes, re-evaluate ad slot rendering
    if (consentAccept) consentAccept.addEventListener('click', () => { renderAdSlot(); });
    if (consentDecline) consentDecline.addEventListener('click', () => { renderAdSlot(); });
    // Splash handlers: accept/decline on the initial blocking splash
    function openConsentSplash() { if (!consentSplash) return; consentSplash.classList.add('open'); consentSplash.setAttribute('aria-hidden','false'); }
    function closeConsentSplash() { if (!consentSplash) return; consentSplash.classList.remove('open'); consentSplash.setAttribute('aria-hidden','true'); }
    if (splashAccept) {
        splashAccept.addEventListener('click', () => {
            setConsent('accepted');
            try { enableFeaturesUI(); fetchLocalNews(); } catch(e){}
            try { renderAdSlot(); } catch(e){}
            closeConsentSplash();
        });
    }
    if (splashDecline) {
        splashDecline.addEventListener('click', async () => {
            try { await clearAllVisitorData(); } catch(e){}
            try { disableFeaturesUI(); } catch(e){}
            try { renderAdSlot(); } catch(e){}
            closeConsentSplash();
        });
    }
    // Privacy modal quick actions: opt-out immediately
    if (privacyOptout) {
        privacyOptout.addEventListener('click', async (e) => {
            e.preventDefault();
            try { await clearAllVisitorData(); } catch(e){}
            // give quick feedback and close the privacy dialog
            try { alert('You have opted out. Local data and caches have been cleared.'); } catch(e){}
            closePrivacy();
        });
    }
    // Sources modal wiring
    const sourcesLink = document.getElementById('sources-link');
    const sourcesModal = document.getElementById('sources-modal');
    const sourcesClose = document.getElementById('sources-close');
    function openSources() { if (!sourcesModal) return; sourcesModal.classList.add('open'); sourcesModal.setAttribute('aria-hidden','false'); }
    function closeSources() { if (!sourcesModal) return; sourcesModal.classList.remove('open'); sourcesModal.setAttribute('aria-hidden','true'); }
    if (sourcesLink) sourcesLink.addEventListener('click', (e) => { e.preventDefault(); buildSourcesContent(); openSources(); });
    if (sourcesClose) sourcesClose.addEventListener('click', closeSources);
    // About modal wiring
    const aboutLink = document.getElementById('about-link');
    const aboutModal = document.getElementById('about-modal');
    const aboutClose = document.getElementById('about-close');
    function openAbout() { if (!aboutModal) return; aboutModal.classList.add('open'); aboutModal.setAttribute('aria-hidden','false'); }
    function closeAbout() { if (!aboutModal) return; aboutModal.classList.remove('open'); aboutModal.setAttribute('aria-hidden','true'); }
    if (aboutLink) aboutLink.addEventListener('click', (e) => { e.preventDefault(); openAbout(); });
    if (aboutClose) aboutClose.addEventListener('click', closeAbout);
    if (aboutModal) aboutModal.addEventListener('click', (ev) => { if (ev.target === aboutModal) closeAbout(); });
    // show banner if not yet decided
    showConsentBanner();
    function openPrivacy() {
        if (!privacyModal) return;
        privacyModal.classList.add('open');
        privacyModal.setAttribute('aria-hidden', 'false');
    }
    function closePrivacy() {
        if (!privacyModal) return;
        privacyModal.classList.remove('open');
        privacyModal.setAttribute('aria-hidden', 'true');
    }
    if (privacyLink) {
        privacyLink.addEventListener('click', (e) => { e.preventDefault(); openPrivacy(); });
    }
    if (privacyClose) privacyClose.addEventListener('click', closePrivacy);
    // Close on backdrop click
    if (privacyModal) {
        privacyModal.addEventListener('click', (ev) => { if (ev.target === privacyModal) closePrivacy(); });
    }
    if (sourcesModal) {
        sourcesModal.addEventListener('click', (ev) => { if (ev.target === sourcesModal) closeSources(); });
    }
    // Close on Esc (privacy or sources)
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closePrivacy(); closeSources(); } });
    
    // Load feeds.json first so news fetches use it
    await loadFeeds();
    // Populate Sources modal content now that feeds are available
    buildSourcesContent();

    // Render ad slot based on current consent state
    renderAdSlot();

    updateClock();
    setInterval(updateClock, 1000);

    // Start features according to toggles (defaults are checked in the markup)
    const tMarket = document.getElementById('toggle-market');
    const tLocal = document.getElementById('toggle-local');
    const tHot = document.getElementById('toggle-hot');
    const tNews = document.getElementById('toggle-news');

    if (tMarket && tMarket.checked) startMarket(); else stopMarket();
    if (tLocal && tLocal.checked) startLocal(); else stopLocal();
    const anyGlobal = (tHot ? tHot.checked : true) || (tNews ? tNews.checked : true);
    if (anyGlobal) startGlobal(); else stopGlobal();
}

window.onload = init;