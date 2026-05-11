const https = require('https');

// ── Helpers ───────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS),
    body: JSON.stringify(obj)
  };
}

function fetchText(url, headers) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: headers || {} }, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        if (res.statusCode === 200) resolve(raw);
        else reject(new Error(res.statusCode + ': ' + raw.substring(0, 300)));
      });
    }).on('error', reject);
  });
}

function putText(url, content, contentType) {
  return new Promise(function(resolve, reject) {
    const bodyBuffer = Buffer.from(content, 'utf8');
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': bodyBuffer.length,
        'x-ms-blob-type': 'BlockBlob'
      }
    };
    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        if (res.statusCode === 200 || res.statusCode === 201) resolve();
        else reject(new Error('PUT ' + res.statusCode + ': ' + raw.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function fetchBinary(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        if (res.statusCode === 200) resolve(Buffer.concat(chunks));
        else reject(new Error(res.statusCode + ': ' + chunks.join('').substring(0, 100)));
      });
    }).on('error', reject);
  });
}

function putBinary(url, buffer, contentType) {
  return new Promise(function(resolve, reject) {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-ms-blob-type': 'BlockBlob'
      }
    };
    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        if (res.statusCode === 200 || res.statusCode === 201) resolve();
        else reject(new Error('PUT ' + res.statusCode + ': ' + raw.substring(0, 100)));
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

function getBlobUrl(sasToken, container, blobName) {
  return 'https://carepathiqdata.blob.core.windows.net/' + container + '/' + blobName + sasToken;
}

function parseCSVLine(line) {
  var result = [], current = '', inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

var KNOWN_SYSTEMS = [
  // ── New England (expanded affiliate lists) ───────────────────────────────
  { name: 'Mass General Brigham', patterns: [
    'mass general','massachusetts general',
    'brigham and women','brigham & women','brigham hospital',
    'mgh ','mgh-','faulkner hospital','faulkner hospital',
    'cooley dickinson','newton-wellesley','newton wellesley',
    'north shore medical','salem hospital','union hospital','union campus',
    'wentworth-douglass','wentworth douglass',
    'martha vineyard hospital','nantucket cottage',
    'ipswich hospital','emerson hospital',
    'spaulding rehab','spaulding rehabilitation',
    'mclean hospital','mcclean hospital',
    'brigham and women faulkner',
    'mass eye and ear','massachusetts eye and ear',
    'cape cod hospital','cape cod healthcare',
    'island hospital'
  ]},
  { name: "Boston Children's", patterns: [
    "boston children's",'boston childrens','childrens hospital boston',
    "children's hospital boston",'bch ','bchc',
    "boston children's primary care","boston children's specialty"
  ]},
  { name: 'Beth Israel Lahey', patterns: [
    'beth israel deaconess','bidmc','beth israel medical',
    'lahey hospital','lahey clinic','lahey health',
    'deaconess hospital','new england deaconess',
    'mount auburn hospital','mount auburn',
    'new england baptist','ne baptist',
    'beverly hospital','addison gilbert',
    'anna jaques hospital','anna jaques',
    'winchester hospital','winchester campus',
    'choate health','cambridge health alliance',
    'nantucket cottage hospital','bmc health','brockton',
    'atlantic medical group','lahey burlington',
    'nash hua hospital','southern new hampshire',
    'Northeast hospital','northeast health system'
  ]},
  { name: 'Atrius Health', patterns: [
    'atrius health','atrius','harvard vanguard','harvard pilgrim',
    'kenmore medical','square medical group','granite medical',
    'dedham medical','chelmsford medical','adult medicine associates',
    'harbor medical','south shore medical','norwood medical',
    'concord medical','wellesley medical','charles river medical'
  ]},
  { name: 'Tufts Medicine', patterns: [
    'tufts medical','tufts medicine','tufts campus',
    'new england medical center','nemc',
    'lowell general hospital','lowell general',
    'melrosewakefield hospital','melrose wakefield',
    'lawrence memorial hospital','lawrence mem',
    'circle health','circle medical group',
    'saints campus','tufts children',
    'floating hospital','tufts shared services',
    'nashoba valley medical','nashoba valley'
  ]},
  { name: 'UMass Memorial', patterns: [
    'umass memorial','u mass memorial','university of massachusetts',
    'umass medical','umass hospital',
    'umass memorial medical center',
    'clinton hospital','health alliance',
    'marlborough hospital','marlborough campus',
    'wing memorial','wing hospital',
    'umass cardiology','umass cancer'
  ]},
  { name: 'Steward Health Care', patterns: [
    'steward','carney hospital','carney campus',
    'good samaritan medical','good samaritan needham',
    'holy family hospital','holy family haverhill',
    'morton hospital','morton taunton',
    'norwood hospital','norwood campus',
    'saint anne hospital','st. anne',
    'st elizabeth medical','saint elizabeth',
    'nashville general steward'
  ]},
  { name: 'Yale New Haven Health', patterns: [
    'yale new haven','yale-new haven','ynhh',
    'yale university hospital','yale medical',
    'bridgeport hospital','greenwich hospital',
    'lawrence + memorial','lawrence memorial new london',
    'westerly hospital','northeast medical group',
    'smilow cancer','yale smilow'
  ]},
  { name: 'Hartford HealthCare', patterns: [
    'hartford hospital','hartford healthcare','hartford health',
    'backus hospital','backus',
    'charlotte hungerford','charlotte hungerford',
    'midstate medical','midstate',
    'natchaug hospital','natchaug',
    'windham hospital','windham',
    'jefferson radiology','medical group of eastern connecticut',
    'the hospital of central connecticut','central connecticut',
    'new britain general'
  ]},
  { name: 'Care New England', patterns: [
    'care new england','women and infants','women & infants',
    'kent hospital','kent county',
    'butler hospital','butler psychiatric',
    'vna of care new england'
  ]},
  { name: 'Lifespan', patterns: [
    'lifespan','rhode island hospital','hasbro children',
    'miriam hospital','the miriam',
    'newport hospital','newport health',
    'bradley hospital','emma pendleton'
  ]},
  { name: 'MaineHealth', patterns: [
    'mainehealth','maine health','maine medical center',
    'maine med','spring harbor hospital',
    'southern maine health','southern maine medical',
    'mid coast hospital','mid coast health',
    'pen bay medical','pen bay',
    'waldo county general','waldo county',
    'lincoln health','miles campus',
    'st. mary regional','st mary regional',
    'franklin memorial hospital','franklin memorial maine'
  ]},
  { name: 'Dartmouth Health', patterns: [
    'dartmouth','mary hitchcock','dartmouth-hitchcock',
    'dartmouth hitchcock','dhmc',
    'alice peck day','alice peck',
    'mt. ascutney','mount ascutney',
    'cheshire medical','cheshire hospital',
    'weeks medical','weeks hospital',
    'new london hospital','new london nh',
    'cottage hospital nh'
  ]},
  // ── National systems ─────────────────────────────────────────────────────
  { name: 'HCA Healthcare',         patterns: ['hca healthcare','hca hospital','columbia/hca','hca affiliated'] },
  { name: 'Trinity Health',         patterns: ['trinity health','mercy health','saint joseph mercy','mercy medical center','mount mercy','saint mary mercy'] },
  { name: 'Ascension',              patterns: ['ascension','providence health ministries','columbia st. mary','wheaton franciscan'] },
  { name: 'CommonSpirit Health',    patterns: ['commonspirit','common spirit','dignity health','chichme','franciscan health','dominican hospital'] },
  { name: 'Advocate Aurora',        patterns: ['advocate aurora','advocate health','aurora health','advocate christ','advocate good samaritan','advocate illinois masonic'] },
  { name: 'Providence',             patterns: ['providence health','providence st','providence regional','providence portland'] },
  { name: 'Northwell Health',       patterns: ['northwell','lenox hill','long island jewish','north shore university hospital','south shore hospital ny','plainview hospital','syosset hospital','huntington hospital ny','phelps hospital','glen cove hospital'] },
  { name: 'NYU Langone',            patterns: ['nyu langone','nyu hospital','nyu medical','bellevue hospital','tisch hospital','manhattan eye ear throat'] },
  { name: 'NewYork-Presbyterian',   patterns: ['newyork-presbyterian','new york presbyterian','nyp ','columbia university medical','weill cornell','morgan stanley children'] },
  { name: 'Mount Sinai',            patterns: ['mount sinai','icahn school','mount sinai beth israel','mount sinai west','mount sinai morningside','new york eye and ear'] },
  { name: 'Memorial Sloan Kettering', patterns: ['memorial sloan','msk ','sloan kettering'] },
  { name: 'Cleveland Clinic',       patterns: ['cleveland clinic','marymount hospital oh','hillcrest hospital oh','fairview hospital oh','lutheran hospital oh','medina hospital oh'] },
  { name: 'Mayo Clinic',            patterns: ['mayo clinic','mayo medical','mayo rochester','mayo health system','mayo hospital'] },
  { name: 'Kaiser Permanente',      patterns: ['kaiser permanente','kaiser foundation','kaiser hospital','kaiser medical center'] },
  { name: 'Sutter Health',          patterns: ['sutter health','sutter medical','sutter memorial','mills-peninsula','alta bates','california pacific medical','cpmc'] },
  { name: 'Intermountain Health',   patterns: ['intermountain','lds hospital','primary childrens','utah valley hospital','mckay-dee'] },
  { name: 'Banner Health',          patterns: ['banner health','banner hospital','banner medical center','banner university'] },
  { name: 'AdventHealth',           patterns: ['adventhealth','advent health','florida hospital','shawnee mission medical','parker adventist'] },
  { name: 'Atrium Health',          patterns: ['atrium health','carolinas medical','mercy atrium','navicent health','wake forest baptist','wake forest medical'] },
  { name: 'Prisma Health',          patterns: ['prisma','palmetto health','greenville memorial','greenville health'] },
  { name: 'OhioHealth',             patterns: ['ohiohealth','ohio health','riverside methodist','grant medical center','doctors hospital oh','grady memorial oh'] },
  { name: 'University Hospitals',   patterns: ['university hospitals','uh medical','uh geauga','uh portage','uh elyria'] },
  { name: 'Penn Medicine',          patterns: ['penn medicine','upenn health','university of pennsylvania health','penn presbyterian','pennsylvania hospital','chester county hospital','lancaster general'] },
  { name: 'Jefferson Health',       patterns: ['jefferson health','thomas jefferson university','jefferson hospital','abington hospital','nemours'] },
  { name: 'ChristianaCare',         patterns: ['christianacare','christiana care','christiana hospital','wilmington hospital de'] },
  { name: 'Spectrum Health',        patterns: ['spectrum health','corewell','blodgett campus','butterworth campus','helen devos'] },
  { name: 'Henry Ford Health',      patterns: ['henry ford','henry ford hospital','henry ford macomb','henry ford wyandotte','henry ford west bloomfield'] },
  { name: 'Beaumont Health',        patterns: ['beaumont health','beaumont hospital','william beaumont'] },
  { name: 'OSF HealthCare',         patterns: ['osf healthcare','osf health','osf saint francis','osf saint anthony'] },
  { name: 'SSM Health',             patterns: ['ssm health','ssm st. mary','ssm depaul','ssm st. francis','ssm st. clare'] },
  { name: 'BJC HealthCare',         patterns: ['bjc','barnes-jewish','christian hospital','missouri baptist','alton memorial'] },
  { name: 'Sanford Health',         patterns: ['sanford health','sanford hospital','sanford medical','sanford bismarck','sanford fargo'] },
  { name: 'Fairview Health',        patterns: ['fairview health','fairview hospital','university of minnesota medical center','fairview ridges'] },
  { name: 'Allina Health',          patterns: ['allina health','abbott northwestern','united hospital mn','mercy hospital mn','river falls medical'] },
  { name: 'HealthPartners',         patterns: ['healthpartners','health partners','regions hospital','methodist hospital mn','lakeview hospital mn'] },
  { name: 'UCHealth',               patterns: ['uchealth','uc health','university of colorado hospital','memorial hospital colorado','poudre valley'] },
  { name: 'Centura Health',         patterns: ['centura','porter adventist','st. francis hospital co','penrose hospital','parker adventist','avista adventist'] },
  { name: 'Scripps Health',         patterns: ['scripps health','scripps memorial','scripps green','scripps mercy','scripps encinitas'] },
  { name: 'Sharp HealthCare',       patterns: ['sharp healthcare','sharp memorial','sharp grossmont','sharp chula vista','sharp coronado'] },
  { name: 'Cedars-Sinai',           patterns: ['cedars-sinai','cedars sinai','marina del rey hospital cs'] },
  { name: 'UCLA Health',            patterns: ['ucla health','ronald reagan ucla','ucla medical center','mattel children'] },
  { name: 'UCSF Health',            patterns: ['ucsf','zuckerberg san francisco general','ucsf benioff','moffitt hospital ucsf'] },
  { name: 'Stanford Health',        patterns: ['stanford health','stanford hospital','stanford medical center','lucile packard'] },
  { name: 'Vanderbilt Health',      patterns: ['vanderbilt','vumc','vanderbilt university medical','vanderbilt wilson county'] },
  { name: 'Emory Healthcare',       patterns: ['emory','emory university hospital','emory saint joseph','emory johns creek','emory decatur'] },
  { name: 'Piedmont Healthcare',    patterns: ['piedmont healthcare','piedmont hospital','piedmont atlanta','piedmont newton','piedmont henry'] },
  { name: 'WellStar Health',        patterns: ['wellstar','wellstar kennestone','wellstar cobb','wellstar douglas','wellstar paulding'] },
  { name: 'Ochsner Health',         patterns: ['ochsner','ochsner medical center','ochsner baptist','ochsner st. anne'] },
  { name: 'LCMC Health',            patterns: ['lcmc','childrens hospital new orleans','university medical center new orleans','touro infirmary','west jefferson medical'] },
  { name: 'CHRISTUS Health',        patterns: ['christus','christus mother frances','christus santa rosa','christus trinity mother frances'] },
  { name: 'Baylor Scott & White',   patterns: ['baylor scott','baylor white','baylor university medical','scott & white','scott and white'] },
  { name: 'Texas Health Resources', patterns: ['texas health resources','texas health harris','texas health presbyterian'] },
  { name: 'Memorial Hermann',       patterns: ['memorial hermann','memorial herman','memorial city medical'] },
  { name: 'Houston Methodist',      patterns: ['houston methodist','methodist hospital houston','houston methodist sugar land'] },
  { name: 'MD Anderson',            patterns: ['md anderson','anderson cancer','university of texas md anderson'] },
  { name: 'Baptist Health',         patterns: ['baptist health','baptist hospital','baptist medical center'] },
  { name: 'Encompass Health',       patterns: ['encompass health','encompass rehabilitation','healthsouth'] },
  { name: 'LifePoint Health',       patterns: ['lifepoint','lifepoint hospital'] },
  { name: 'Community Health Systems', patterns: ['community health systems','chs hospital','chs medical center'] },
  { name: 'Tenet Healthcare',       patterns: ['tenet','detroit medical center','hahnemann university hospital','palm beach gardens medical'] },
  { name: 'Universal Health',       patterns: ['universal health services','uhs hospital','universal health','behavioral health uhs'] },
  { name: 'Ascension',              patterns: ['ascension'] },
  { name: 'CommonSpirit Health',    patterns: ['commonspirit','common spirit','dignity health','chichme'] },
  { name: 'Advocate Aurora',        patterns: ['advocate aurora','advocate health','aurora health'] },
  { name: 'Providence',             patterns: ['providence health','providence st'] },
  { name: 'Northwell Health',       patterns: ['northwell'] },
  { name: 'NYU Langone',            patterns: ['nyu langone','nyu hospital'] },
  { name: 'NewYork-Presbyterian',   patterns: ['newyork-presbyterian','new york presbyterian','nyp '] },
  { name: 'Mount Sinai',            patterns: ['mount sinai','icahn'] },
  { name: 'Memorial Sloan Kettering', patterns: ['memorial sloan','msk ','sloan kettering'] },
  { name: 'Cleveland Clinic',       patterns: ['cleveland clinic'] },
  { name: 'Mayo Clinic',            patterns: ['mayo clinic'] },
  { name: 'Kaiser Permanente',      patterns: ['kaiser'] },
  { name: 'Sutter Health',          patterns: ['sutter'] },
  { name: 'Intermountain Health',   patterns: ['intermountain'] },
  { name: 'Banner Health',          patterns: ['banner health','banner hospital'] },
  { name: 'AdventHealth',           patterns: ['adventhealth','advent health','florida hospital'] },
  { name: 'Atrium Health',          patterns: ['atrium health','carolinas medical'] },
  { name: 'Prisma Health',          patterns: ['prisma'] },
  { name: 'OhioHealth',             patterns: ['ohiohealth','ohio health'] },
  { name: 'University Hospitals',   patterns: ['university hospitals'] },
  { name: 'Penn Medicine',          patterns: ['penn medicine','university of pennsylvania health'] },
  { name: 'Jefferson Health',       patterns: ['jefferson health','thomas jefferson'] },
  { name: 'MaineHealth',            patterns: ['mainehealth','maine health','maine medical'] },
  { name: 'Dartmouth Health',       patterns: ['dartmouth','mary hitchcock'] },
  { name: 'ChristianaCare',         patterns: ['christianacare','christiana care'] },
  { name: 'Spectrum Health',        patterns: ['spectrum health','corewell'] },
  { name: 'Henry Ford Health',      patterns: ['henry ford'] },
  { name: 'Beaumont Health',        patterns: ['beaumont'] },
  { name: 'OSF HealthCare',         patterns: ['osf healthcare','osf health'] },
  { name: 'SSM Health',             patterns: ['ssm health'] },
  { name: 'BJC HealthCare',         patterns: ['bjc'] },
  { name: 'Barnes-Jewish',          patterns: ['barnes-jewish','barnes jewish'] },
  { name: 'Sanford Health',         patterns: ['sanford health'] },
  { name: 'Fairview Health',        patterns: ['fairview'] },
  { name: 'Allina Health',          patterns: ['allina'] },
  { name: 'HealthPartners',         patterns: ['healthpartners','health partners'] },
  { name: 'UCHealth',               patterns: ['uchealth','uc health'] },
  { name: 'SCL Health',             patterns: ['scl health'] },
  { name: 'Centura Health',         patterns: ['centura'] },
  { name: 'Scripps Health',         patterns: ['scripps'] },
  { name: 'Sharp HealthCare',       patterns: ['sharp healthcare','sharp hospital'] },
  { name: 'Dignity Health',         patterns: ['dignity health'] },
  { name: 'Cedars-Sinai',           patterns: ['cedars-sinai','cedars sinai'] },
  { name: 'UCLA Health',            patterns: ['ucla health','ronald reagan ucla'] },
  { name: 'UCSF Health',            patterns: ['ucsf'] },
  { name: 'Stanford Health',        patterns: ['stanford health','stanford hospital'] },
  { name: 'Vanderbilt Health',      patterns: ['vanderbilt'] },
  { name: 'Emory Healthcare',       patterns: ['emory'] },
  { name: 'Piedmont Healthcare',    patterns: ['piedmont healthcare'] },
  { name: 'WellStar Health',        patterns: ['wellstar'] },
  { name: 'Ochsner Health',         patterns: ['ochsner'] },
  { name: 'LCMC Health',            patterns: ['lcmc'] },
  { name: 'CHRISTUS Health',        patterns: ['christus'] },
  { name: 'Baylor Scott & White',   patterns: ['baylor scott','baylor white'] },
  { name: 'Texas Health Resources', patterns: ['texas health resources'] },
  { name: 'Methodist Health',       patterns: ['methodist health system','methodist dallas','methodist mansfield','methodist midlothian','methodist charlton','methodist southlake'] },
  { name: 'Memorial Hermann',       patterns: ['memorial hermann','memorialhermann'] },
  { name: 'Houston Methodist',      patterns: ['houston methodist','methodist hospital houston','houston methodist sugar land','houston methodist west','houston methodist willowbrook','houston methodist baytown','houston methodist clear lake','houston methodist the woodlands','houston methodist san jacinto'] },
  { name: 'MD Anderson',            patterns: ['md anderson','anderson cancer'] },
  { name: 'Baptist Health',         patterns: ['baptist health'] },
  { name: 'Encompass Health',       patterns: ['encompass'] },
  { name: 'LifePoint Health',       patterns: ['lifepoint'] },
  { name: 'Community Health Systems', patterns: ['community health systems','chs hospital'] },
  { name: 'Tenet Healthcare',       patterns: ['tenet'] },
  { name: 'Universal Health',       patterns: ['universal health','uhs '] },
];

// Build search tokens from a typed name — splits on spaces, dashes, common words
function tokenize(str) {
  // Only strip pure connector words — keep substantive words like 'health',
  // 'methodist', 'memorial' etc. that distinguish one system from another.
  var stopwords = new Set(['the','and','for','of','at','in','by','to','a','an']);
  return str.toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(function(w){ return w.length > 1 && !stopwords.has(w); });
}

// Score how well a facility name matches the typed target (0 = no match)
function matchScore(facilityName, targetTokens) {
  if (!facilityName) return 0;
  const fn = facilityName.toLowerCase();
  let score = 0;
  targetTokens.forEach(function(tok) {
    if (fn.includes(tok)) score++;
  });
  return score;
}

function groupBySystem(facilities, targetInput) {
  const systems = {};
  const targetTokens = tokenize(targetInput);
  const targetLower  = targetInput.toLowerCase();
  // Pre-compute target domain if user typed a known system name
  var targetDomain = null;
  if (typeof DOMAIN_SYSTEM_MAP !== 'undefined') {
    Object.entries(DOMAIN_SYSTEM_MAP).forEach(function(entry) {
      if (entry[1].toLowerCase() === targetLower ||
          entry[1].toLowerCase().includes(targetLower) ||
          targetLower.includes(entry[1].toLowerCase().split(' ')[0])) {
        targetDomain = entry[0];
      }
    });
  }

  facilities.forEach(function(h) {
    var rawName = h.tags && h.tags.name ? h.tags.name : 'Unknown';
    var npiOrg  = h.tags && h.tags.npi_org ? h.tags.npi_org : '';
    const name    = (npiOrg.length > rawName.length) ? npiOrg : rawName;
    const nameLow = name.toLowerCase();
    let bucket    = null;

    // ── Step -1: Check saved overrides by stable key (highest priority) ──────
    var stableKey = overrideKey(h);
    if (systemOverrides[stableKey]) {
      bucket = systemOverrides[stableKey];
    }

    // ── Step 0: Use authoritative domain attribution from embedded data ──────
    // This is the most reliable signal — the endpoint domain identifies
    // exactly which EHR instance (= health system) the facility belongs to.
    var facDomain = h.dom || (h.tags && h.tags.dom) || '';
    var facSys    = h._embeddedSystem || (h.tags && h.tags._embeddedSystem) || '';

    if (!bucket && facDomain && typeof DOMAIN_SYSTEM_MAP !== 'undefined') {
      var mappedSys = DOMAIN_SYSTEM_MAP[facDomain];
      if (mappedSys) {
        // Check if this domain matches the target
        if (facDomain === targetDomain ||
            (targetTokens.length > 0 && matchScore(mappedSys, targetTokens) === targetTokens.length)) {
          bucket = targetInput;
        } else {
          bucket = mappedSys;
        }
      }
    }

    // Use pre-assigned system from embedded data if available
    if (!bucket && facSys) {
      if (targetTokens.length > 0 && matchScore(facSys, targetTokens) === targetTokens.length) {
        bucket = targetInput;
      } else {
        bucket = facSys;
      }
    }

    // ── Step 1: Match against the typed target by name (fallback for OSM/NPI)
    if (!bucket && targetTokens.length > 0 &&
        matchScore(name, targetTokens) === targetTokens.length) {
      bucket = targetInput;
    }

    // ── Step 2: Match against known parent health system names
    if (!bucket) {
      for (var i = 0; i < KNOWN_SYSTEMS.length; i++) {
        var sys = KNOWN_SYSTEMS[i];
        // Skip if this system matches the typed target (avoid double-claiming)
        if (sys.name.toLowerCase() === targetLower ||
            targetTokens.some(function(t){ return sys.name.toLowerCase().includes(t); })) continue;
        for (var j = 0; j < sys.patterns.length; j++) {
          var pat = sys.patterns[j];
          // Use word-boundary check: pattern must appear as a whole phrase,
          // not as a fragment inside another word
          var patRx = new RegExp('(?:^|[\\s\\-,\\/])' + pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?:[\\s\\-,\\/]|$)');
          if (patRx.test(nameLow)) {
            bucket = sys.name;
            break;
          }
        }
        if (bucket) break;
      }
    }

    // ── Step 3: Anything unrecognized → "Independent / Community"
    // No keyword-fragment bucketing — keeps the legend and insights clean.
    if (!bucket) {
      bucket = 'Independent / Community';
    }

    if (!systems[bucket]) systems[bucket] = [];
    systems[bucket].push(h);
  });

  // ── Step 4: Dynamic auto-grouping ─────────────────────────────────────────
  // Look at facilities still in "Independent / Community" and group any that
  // share an uncommon prefix (3+ facilities with the same meaningful name start).
  var indFacs = systems['Independent / Community'] || [];
  if (indFacs.length > 0) {
    var autoGroups = autoGroupByName(indFacs);
    Object.keys(autoGroups).forEach(function(groupName) {
      var grouped = autoGroups[groupName];
      if (grouped.length >= 3) {
        // Move these out of Independent into their own bucket
        systems['Independent / Community'] = (systems['Independent / Community'] || [])
          .filter(function(f) { return !grouped.some(function(g) { return g.id === f.id; }); });
        if (!systems[groupName]) systems[groupName] = [];
        systems[groupName] = systems[groupName].concat(grouped);
      }
    });
    // Clean up empty Independent bucket
    if (systems['Independent / Community'] && systems['Independent / Community'].length === 0) {
      delete systems['Independent / Community'];
    }
  }

  return systems;
}

// ── Auto-grouping by shared name prefix ───────────────────────────────────────
// Common generic words that should NOT trigger auto-grouping on their own
const AUTO_GROUP_STOPWORDS = new Set([
  // Articles / prepositions
  'the','and','of','at','in','for','a','an','by','to','with',
  // Generic healthcare words
  'medical','health','care','center','centre','clinic','hospital',
  'medicine','group','associates','services','system','network',
  'practice','practices','physicians','physician','doctors','doctor',
  'regional','community','general','national','university','institute',
  'wellness','healthcare','specialty','specialist','specialists',
  'ambulatory','surgical','surgery','outpatient','inpatient',
  // Directional / generic location words
  'new','old','north','south','east','west','central','upper','lower',
  'greater','metro','metropolitan','suburban','downtown','midtown',
  // Religious / system branding words
  'saint','st','mt','mount','holy','sacred','mercy','providence',
  'memorial','foundation','partners','alliance','integrated',
  // State abbreviations that appear in names
  'ma','ct','ri','nh','vt','me','ny','nj','pa',
  // Common city names that appear as prefixes
  'boston','cambridge','worcester','springfield','lowell','newton',
  'quincy','brockton','lynn','somerville','fall','new','framingham',
  // Words that trail off into location (causing truncation)
  'faculty','harvard','for','by','at','with','via'
]);

function autoGroupByName(facilities) {
  var groups = {};

  facilities.forEach(function(f) {
    var name = (f.tags && f.tags.name) ? f.tags.name : '';
    if (!name) return;

    var words = name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function(w) { return w.length > 1; });

    // Try prefix lengths from 3 words down to 2
    for (var len = Math.min(4, words.length); len >= 2; len--) {
      var prefix = words.slice(0, len);

      // Skip if ALL words are stopwords
      var meaningfulWords = prefix.filter(function(w) { return !AUTO_GROUP_STOPWORDS.has(w); });
      if (meaningfulWords.length === 0) continue;

      // Skip if the FIRST word is a stopword — too generic
      if (AUTO_GROUP_STOPWORDS.has(prefix[0])) continue;

      // Need at least one truly distinctive word (not a stopword) in first 2 words
      var firstTwoMeaningful = prefix.slice(0, 2).filter(function(w) { return !AUTO_GROUP_STOPWORDS.has(w); });
      if (firstTwoMeaningful.length === 0) continue;

      // If first word is meaningful and short (likely acronym), allow full prefix even with stopwords
      var firstWord = prefix[0];
      var isAcronym = firstWord.length <= 5 && /^[a-z]+$/.test(firstWord);
      // For acronym-led names, use just the first 3 words as the key (e.g. "afc urgent care")
      if (isAcronym && len > 3) continue; // don't use 4-word prefixes for acronyms

      var key = prefix.join(' ');

      // Capitalize properly for display
      // Rebuild display name from ORIGINAL facility name words, not lowercased
      var origWords = name.split(/\s+/);
      var displayName = prefix.map(function(w, wi) {
        // Find the original casing for this word position
        var orig = origWords[wi] || w;
        // If original is all-caps and short (acronym like AFC, ER), preserve it
        if (orig.length <= 4 && orig === orig.toUpperCase() && /^[A-Z]+$/.test(orig)) return orig;
        return AUTO_GROUP_STOPWORDS.has(w) ? w : (orig.charAt(0).toUpperCase() + orig.slice(1).toLowerCase());
      }).join(' ');

      if (!groups[displayName]) groups[displayName] = [];

      // Only add if not already in a longer prefix group
      var alreadyGrouped = Object.keys(groups).some(function(g) {
        return g !== displayName && g.toLowerCase().startsWith(key) &&
               groups[g].some(function(gf) { return gf.id === f.id; });
      });

      if (!alreadyGrouped) {
        groups[displayName].push(f);
        break; // Use the longest matching prefix
      }
    }
  });

  // Remove groups where facilities actually belong to a longer/more specific group
  // Keep only the most specific match per facility
  var finalGroups = {};
  var assigned = new Set();

  // Sort by prefix length descending — longer prefix = more specific
  Object.keys(groups).sort(function(a, b) { return b.length - a.length; }).forEach(function(gName) {
    var unassigned = groups[gName].filter(function(f) { return !assigned.has(f.id); });
    if (unassigned.length >= 3) {
      finalGroups[gName] = unassigned;
      unassigned.forEach(function(f) { assigned.add(f.id); });
    }
  });

  return finalGroups;
}


// ── Icon index helpers ────────────────────────────────────────────────────────
async function readIconIndex(sasToken) {
  try {
    const raw = await fetchText(getBlobUrl(sasToken, 'logos', 'icon-index.json'));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    if (e.message && e.message.startsWith('404')) return [];
    throw e;
  }
}

async function updateIconIndex(sasToken, system, op) {
  let systems = [];
  try { systems = await readIconIndex(sasToken); } catch(e) { /* start fresh */ }
  if (op === 'add') {
    if (!systems.includes(system)) systems.push(system);
  } else {
    systems = systems.filter(function(s) { return s !== system; });
  }
  await putText(getBlobUrl(sasToken, 'logos', 'icon-index.json'), JSON.stringify(systems), 'application/json');
}

let qhinCache = null, qhinCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

// ── Referral Flow Model Constants ─────────────────────────────────────────────
// Based on Care Continuity ED-to-Specialist Value Model (50k patient base).
// These are the fixed assumptions from the spreadsheet model. All margin figures
// are per-referral-completion values derived from the 100k ED visit baseline,
// scaled to 50k for the demo pool.
const REFERRAL_MODEL = {
  totalPool: 50000,
  edVisitRate: 0.82,          // 82% of visits become discharges
  referralRate: 0.23,          // 23% of discharges referred to targeted specialties
  baseCompletionRate: 0.40,    // 40% current in-network completion rate
  specialties: {
    cardiovascular:    { share: 0.16, opMargin: 218,  ipMargin: 7228, surgMargin: 4749, opRate: 0.11, ipRate: 0.05, surgRate: 0.02 },
    gastroenterology:  { share: 0.18, opMargin: 205,  ipMargin: 6771, surgMargin: 864,  opRate: 0.12, ipRate: 0.09, surgRate: 0.06 },
    generalMedicine:   { share: 0.12, opMargin: 96,   ipMargin: 5001, surgMargin: 1501, opRate: 0.36, ipRate: 0.06, surgRate: 0.05 },
    neurosciences:     { share: 0.04, opMargin: 336,  ipMargin: 5361, surgMargin: 1000, opRate: 0.52, ipRate: 0.37, surgRate: 0.02 },
    orthopedics:       { share: 0.28, opMargin: 239,  ipMargin: 3865, surgMargin: 1000, opRate: 0.83, ipRate: 0.14, surgRate: 0.05 },
    spine:             { share: 0.03, opMargin: 212,  ipMargin: 7201, surgMargin: 7004, opRate: 0.98, ipRate: 0.10, surgRate: 0.02 },
    surgeryENT:        { share: 0.05, opMargin: 121,  ipMargin: 2500, surgMargin: 2500, opRate: 0.04, ipRate: 0.02, surgRate: 0.02 },
    surgeryGeneral:    { share: 0.08, opMargin: 127,  ipMargin: 8467, surgMargin: 3968, opRate: 0.14, ipRate: 0.22, surgRate: 0.08 },
    surgeryUrology:    { share: 0.06, opMargin: 110,  ipMargin: 6344, surgMargin: 2650, opRate: 0.61, ipRate: 0.09, surgRate: 0.09 }
  }
};

// Compute referral flow data for a set of competitor systems.
// competitorSystems: array of { name, marketShare, lat, lon, facilityId }
// targetSystem: { name, lat, lon }
// Returns the full referral flow payload stored as referral_flows.json per system.
function computeReferralFlows(targetSystem, competitorSystems) {
  const pool = REFERRAL_MODEL.totalPool;
  const edDischarges = Math.round(pool * REFERRAL_MODEL.edVisitRate);
  const totalReferrals = Math.round(edDischarges * REFERRAL_MODEL.referralRate);
  const completedInNetwork = Math.round(totalReferrals * REFERRAL_MODEL.baseCompletionRate);
  const totalLost = totalReferrals - completedInNetwork;

  // Normalize competitor market shares to sum to 1.0 so leakage distribution is clean.
  const totalShare = competitorSystems.reduce(function(sum, c) { return sum + (c.marketShare || 0); }, 0);
  const normalizedCompetitors = competitorSystems.map(function(c) {
    return Object.assign({}, c, { normalizedShare: totalShare > 0 ? (c.marketShare || 0) / totalShare : 1 / competitorSystems.length });
  });

  // Build per-specialty breakdown.
  const specialtyFlows = {};
  var totalMarginAtRisk = 0;

  Object.keys(REFERRAL_MODEL.specialties).forEach(function(key) {
    const spec = REFERRAL_MODEL.specialties[key];
    const specReferrals = Math.round(totalReferrals * spec.share);
    const specCompleted = Math.round(specReferrals * REFERRAL_MODEL.baseCompletionRate);
    const specLost = specReferrals - specCompleted;

    // Downstream margin at risk = lost referrals * downstream utilization * margin per visit type
    const opMarginAtRisk    = specLost * spec.opRate   * spec.opMargin;
    const ipMarginAtRisk    = specLost * spec.ipRate   * spec.ipMargin;
    const surgMarginAtRisk  = specLost * spec.surgRate * spec.surgMargin;
    const totalSpecMargin   = opMarginAtRisk + ipMarginAtRisk + surgMarginAtRisk;
    totalMarginAtRisk += totalSpecMargin;

    // Distribute lost referrals across competitors by normalized market share.
    const competitorAllocations = normalizedCompetitors.map(function(c) {
      return {
        facilityId:   c.facilityId || null,
        name:         c.name,
        lat:          c.lat,
        lon:          c.lon,
        marketShare:  c.marketShare,
        lostReferrals: Math.round(specLost * c.normalizedShare),
        marginAtRisk: Math.round(totalSpecMargin * c.normalizedShare)
      };
    });

    specialtyFlows[key] = {
      displayName:         formatSpecialtyName(key),
      totalReferrals:      specReferrals,
      completedInNetwork:  specCompleted,
      lostReferrals:       specLost,
      leakageRate:         specLost / specReferrals,
      marginAtRisk:        Math.round(totalSpecMargin),
      competitorAllocations: competitorAllocations
    };
  });

  // Build top-level competitor summary (aggregate across all specialties).
  const competitorSummary = normalizedCompetitors.map(function(c) {
    var totalLostToComp = 0, totalMarginToComp = 0;
    Object.values(specialtyFlows).forEach(function(sf) {
      const alloc = sf.competitorAllocations.find(function(a) { return a.name === c.name; });
      if (alloc) {
        totalLostToComp  += alloc.lostReferrals;
        totalMarginToComp += alloc.marginAtRisk;
      }
    });
    return {
      facilityId:   c.facilityId || null,
      name:         c.name,
      lat:          c.lat,
      lon:          c.lon,
      marketShare:  c.marketShare,
      totalLostReferrals: totalLostToComp,
      totalMarginAtRisk:  totalMarginToComp,
      leakageShare: totalLostToComp / totalLost
    };
  });

  return {
    generatedAt:        new Date().toISOString(),
    targetSystem:       targetSystem.name,
    targetLat:          targetSystem.lat,
    targetLon:          targetSystem.lon,
    patientPool:        pool,
    totalReferrals:     totalReferrals,
    completedInNetwork: completedInNetwork,
    totalLost:          totalLost,
    overallLeakageRate: totalLost / totalReferrals,
    totalMarginAtRisk:  Math.round(totalMarginAtRisk),
    specialtyFlows:     specialtyFlows,
    competitorSummary:  competitorSummary
  };
}

function formatSpecialtyName(key) {
  const names = {
    cardiovascular:   'Cardiovascular',
    gastroenterology: 'Gastroenterology',
    generalMedicine:  'General Medicine',
    neurosciences:    'Neurosciences',
    orthopedics:      'Orthopedics',
    spine:            'Spine',
    surgeryENT:       'Surgery — ENT',
    surgeryGeneral:   'Surgery — General',
    surgeryUrology:   'Surgery — Urology'
  };
  return names[key] || key;
}

// ── Netlify Function handler ───────────────────────────────────────────────────
exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || '';
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';

  console.log('Router: ' + event.httpMethod + ' action=' + action);

  try {

    // ── debug ───────────────────────────────────────────────────────────────
    if (action === 'debug') {
      return jsonResponse(200, {
        hasSasToken: sasToken.length > 0,
        sasLength: sasToken.length,
        nodeVersion: process.version,
        qhinCached: qhinCache ? qhinCache.length : 0,
        action: action,
        platform: 'netlify'
      });
    }

    // ── npi-proxy ────────────────────────────────────────────────────────────
    if (action === 'npi-proxy') {
      const npiParams = Object.assign({}, params);
      delete npiParams.action;
      const qs = '?' + new URLSearchParams(npiParams).toString();
      try {
        const data = await fetchText('https://npiregistry.cms.hhs.gov/api/' + qs);
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: data };
      } catch(err) {
        return jsonResponse(502, { error: 'NPI failed', detail: err.message });
      }
    }

    // ── geocode-proxy ────────────────────────────────────────────────────────
    if (action === 'geocode-proxy') {
      const gParams = Object.assign({}, params);
      delete gParams.action;
      const qs2 = new URLSearchParams(gParams).toString() + '&format=json';
      const isRev = !!gParams.lat;
      const gUrl = 'https://nominatim.openstreetmap.org/' + (isRev ? 'reverse?' : 'search?') + qs2;
      try {
        const data = await fetchText(gUrl, { 'User-Agent': 'CarePathIQ/1.0', 'Accept-Language': 'en' });
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: data };
      } catch(err) {
        return jsonResponse(502, { error: 'Geocode failed', detail: err.message });
      }
    }

    // ── geocache-get ─────────────────────────────────────────────────────────
    if (action === 'geocache-get') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const cacheKey = params.key || '';
      if (!cacheKey) return jsonResponse(400, { error: 'key param required' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'geocode_cache.json'));
        const cache = JSON.parse(raw);
        const entry = cache[cacheKey];
        if (entry && entry.lat && entry.lon) {
          return jsonResponse(200, { hit: true, lat: entry.lat, lon: entry.lon });
        }
        return jsonResponse(200, { hit: false });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { hit: false });
        return jsonResponse(502, { error: 'Geocache get failed', detail: err.message });
      }
    }

    // ── geocache-set ─────────────────────────────────────────────────────────
    if (action === 'geocache-set') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      let newEntries;
      try { newEntries = JSON.parse(event.body || '{}'); } catch(e) { return jsonResponse(400, { error: 'Invalid JSON body' }); }
      try {
        let cache = {};
        try {
          const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'geocode_cache.json'));
          cache = JSON.parse(raw);
        } catch(e) { /* cache doesn't exist yet */ }
        const ts = new Date().toISOString();
        Object.keys(newEntries).forEach(function(k) {
          cache[k] = { lat: newEntries[k].lat, lon: newEntries[k].lon, ts: ts };
        });
        await putText(getBlobUrl(sasToken, 'app-state', 'geocode_cache.json'), JSON.stringify(cache), 'application/json');
        return jsonResponse(200, { success: true, total_cached: Object.keys(cache).length });
      } catch(err) {
        return jsonResponse(500, { error: 'Geocache set failed', detail: err.message });
      }
    }

    // ── qhin-data ────────────────────────────────────────────────────────────
    if (action === 'qhin-data') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      if (qhinCache && (Date.now() - qhinCacheTime) < CACHE_TTL) {
        return jsonResponse(200, { facilities: qhinCache, count: qhinCache.length });
      }
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'));
        qhinCache = JSON.parse(raw);
        qhinCacheTime = Date.now();
        return jsonResponse(200, { facilities: qhinCache, count: qhinCache.length });
      } catch(err) {
        return jsonResponse(502, { error: 'QHIN load failed', detail: err.message });
      }
    }

    // ── convert-qhin ─────────────────────────────────────────────────────────
    if (action === 'convert-qhin') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.csv'));
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        function colIdx(name) {
          return headers.findIndex(function(h) { return h.toLowerCase().trim() === name.toLowerCase(); });
        }
        const iName = colIdx('DisplayName'), iLat = colIdx('Latitude'), iLon = colIdx('Longitude');
        const iAddr = colIdx('Address'), iCity = colIdx('City'), iState = colIdx('State');
        const iZip = colIdx('ZipCode'), iOrg = colIdx('OrganizationId');
        if (iName < 0 || iLat < 0 || iLon < 0) return jsonResponse(400, { error: 'Columns not found', found: headers.join(', ') });
        var facilities = [], skipped = 0;
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var cols = parseCSVLine(line);
          var name = (cols[iName] || '').trim();
          var lat = parseFloat(cols[iLat]);
          var lon = parseFloat(cols[iLon]);
          if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) { skipped++; continue; }
          facilities.push({
            id: 'qhin_' + (iOrg >= 0 ? (cols[iOrg] || i) : i),
            type: 'excel', lat: lat, lon: lon,
            tags: {
              name: name,
              address: iAddr >= 0 ? (cols[iAddr] || '').trim() : '',
              city: iCity >= 0 ? (cols[iCity] || '').trim() : '',
              state: iState >= 0 ? (cols[iState] || '').trim() : '',
              postcode: iZip >= 0 ? (cols[iZip] || '').trim() : ''
            },
            _embeddedSystem: '', _facType: ''
          });
        }
        await putText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'), JSON.stringify(facilities), 'application/json');
        qhinCache = null;
        return jsonResponse(200, { success: true, facilities: facilities.length, skipped: skipped });
      } catch(err) {
        return jsonResponse(500, { error: 'Conversion failed', detail: err.message });
      }
    }

    // ── state-load ───────────────────────────────────────────────────────────
    if (action === 'state-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'));
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: raw };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { overrides: {}, customSystems: [], excluded: [] });
        }
        return jsonResponse(502, { error: 'State load failed', detail: err.message });
      }
    }

// ── competitors-near ─────────────────────────────────────────────────────────
if (action === 'competitors-near') {
  const lat    = parseFloat(params.lat   || '0');
  const lon    = parseFloat(params.lon   || '0');
  const miles  = parseFloat(params.miles || '25');
  const target = (params.target || '').toLowerCase().trim();
  if (!lat || !lon) return jsonResponse(400, { error: 'lat and lon required' });
  const radiusM = miles * 1609.34;

  try {
    // Load state and QHIN in parallel
    if (!qhinCache || (Date.now() - qhinCacheTime) >= CACHE_TTL) {
      const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'));
      qhinCache     = JSON.parse(raw);
      qhinCacheTime = Date.now();
    }
    const facilities = Array.isArray(qhinCache) ? qhinCache : (qhinCache.facilities || []);

    let overrides = {};
    try {
      const stateRaw = await fetchText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'));
      overrides = JSON.parse(stateRaw).overrides || {};
    } catch(e) { /* no overrides */ }

    function distM(lat1, lon1, lat2, lon2) {
      const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // Build override lookup by stable key (name|lat|lon format)
    const overrideLookup = {};
    Object.entries(overrides).forEach(function([key, sysName]) {
      const parts = key.split('|');
      if (parts.length === 3) {
        overrideLookup[key] = sysName;
      }
    });

    const counts = {};
    let targetCount = 0;

    facilities.forEach(function(f) {
      const fLat = parseFloat(f.lat || (f.center && f.center.lat) || 0);
      const fLon = parseFloat(f.lon || (f.center && f.center.lon) || 0);
      if (!fLat || !fLon) return;
      if (distM(lat, lon, fLat, fLon) > radiusM) return;

      // Check overrides first
      const name = (f.tags && f.tags.name) || f.name || '';
      const nameLow = name.toLowerCase();
      const stableKey = name.toLowerCase().replace(/\s+/g,'_') + '|' + fLat.toFixed(3) + '|' + fLon.toFixed(3);
      
      let bucket = overrides[stableKey] || null;

      // Name-based target match
      if (!bucket && target && nameLow.includes(target.split(' ')[0])) {
        bucket = params.target;
      }

      if (!bucket) bucket = 'Independent / Community';
      if (bucket === 'Independent / Community') return;

      const bucketLow = bucket.toLowerCase();
      if (target && (bucketLow === target || bucketLow.includes(target) || target.includes(bucketLow.split(' ')[0]))) {
        targetCount++;
      } else {
        counts[bucket] = (counts[bucket] || 0) + 1;
      }
    });

    const total = targetCount + Object.values(counts).reduce((a, b) => a + b, 0);
    const competitors = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([name, count]) => ({
        name,
        count,
        share: total > 0 ? Math.round(count / total * 100) : 0
      }));

    return jsonResponse(200, {
      competitors,
      targetCount,
      total,
      center: { lat, lon },
      miles
    });
  } catch(err) {
    return jsonResponse(502, { error: 'competitors-near failed', detail: err.message });
  }
}
    
    // ── state-save ───────────────────────────────────────────────────────────
    if (action === 'state-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const body = event.body || '{}';
        JSON.parse(body);
        await putText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'), body, 'application/json');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'State save failed', detail: err.message });
      }
    }

    // ── icon-load ────────────────────────────────────────────────────────────
    if (action === 'icon-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = params.system || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const buffer = await fetchBinary(getBlobUrl(sasToken, 'logos', blobName));
        if (!buffer || buffer.length === 0) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(200, { dataUrl: 'data:image/png;base64,' + buffer.toString('base64') });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(502, { error: 'Icon load failed', detail: err.message });
      }
    }

    // ── icon-save ────────────────────────────────────────────────────────────
    if (action === 'icon-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = params.system || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const dataUrl = event.body || '';
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!matches) return jsonResponse(400, { error: 'Invalid data URL' });
        const buffer = Buffer.from(matches[2], 'base64');
        await putBinary(getBlobUrl(sasToken, 'logos', blobName), buffer, matches[1]);
        await updateIconIndex(sasToken, system, 'add');
        return jsonResponse(200, { success: true, bytes: buffer.length, system: system });
      } catch(err) {
        return jsonResponse(500, { error: 'Icon save failed', detail: err.message });
      }
    }

    // ── icon-clear ───────────────────────────────────────────────────────────
    if (action === 'icon-clear') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = params.system || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        await putBinary(getBlobUrl(sasToken, 'logos', blobName), Buffer.alloc(0), 'image/png');
        await updateIconIndex(sasToken, system, 'remove');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'Icon clear failed', detail: err.message });
      }
    }

    // ── logo-load ────────────────────────────────────────────────────────────
    if (action === 'logo-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const buffer = await fetchBinary(getBlobUrl(sasToken, 'logos', 'cc-logo'));
        if (!buffer || buffer.length === 0) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(200, { dataUrl: 'data:image/png;base64,' + buffer.toString('base64') });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(502, { error: 'Logo load failed', detail: err.message });
      }
    }

    // ── logo-save ────────────────────────────────────────────────────────────
    if (action === 'logo-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const dataUrl = event.body || '';
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!matches) return jsonResponse(400, { error: 'Invalid data URL' });
        const buffer = Buffer.from(matches[2], 'base64');
        await putBinary(getBlobUrl(sasToken, 'logos', 'cc-logo'), buffer, matches[1]);
        return jsonResponse(200, { success: true, bytes: buffer.length });
      } catch(err) {
        return jsonResponse(500, { error: 'Logo save failed', detail: err.message });
      }
    }

    // ── logo-clear ───────────────────────────────────────────────────────────
    if (action === 'logo-clear') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        await putBinary(getBlobUrl(sasToken, 'logos', 'cc-logo'), Buffer.alloc(0), 'image/png');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'Logo clear failed', detail: err.message });
      }
    }

    // ── cms-columns ──────────────────────────────────────────────────────────
    if (action === 'cms-columns') {
      try {
        const cmsUrl = 'https://data.cms.gov/sites/default/files/2026-01/c500f848-83b3-4f29-a677-562243a2f23b/Hospital_and_other.DATA.Q4_2025.csv';
        const raw = await fetchText(cmsUrl);
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        const sample = lines[1] ? parseCSVLine(lines[1]) : [];
        const preview = {};
        headers.forEach(function(h, i) { preview[h] = sample[i] || ''; });
        return jsonResponse(200, { columns: headers, sample: preview, total_lines: lines.length });
      } catch(err) {
        return jsonResponse(500, { error: 'CMS columns check failed', detail: err.message });
      }
    }

    // ── build-cms ────────────────────────────────────────────────────────────
    if (action === 'build-cms') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const PROVIDER_TYPE_MAP = {
        '01':'hospital','02':'hospital','03':'hospital','04':'hospital',
        '05':'hospital','06':'hospital','07':'outpatient','08':'outpatient',
        '09':'rehab','10':'rehab','11':'clinic','12':'rehab',
        '13':'outpatient','14':'rehab','15':'outpatient','16':'rehab',
        '17':'clinic','18':'outpatient','19':'clinic','20':'clinic',
        '21':'hospital','22':'clinic','23':'outpatient','24':'clinic',
        '25':'specialist','26':'rehab','27':'clinic','28':'outpatient',
        '29':'outpatient','31':'outpatient','33':'hospital'
      };
      try {
        const cmsUrl = 'https://data.cms.gov/sites/default/files/2026-01/c500f848-83b3-4f29-a677-562243a2f23b/Hospital_and_other.DATA.Q4_2025.csv';
        const raw = await fetchText(cmsUrl);
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        function col(row, ...names) {
          for (var i = 0; i < names.length; i++) {
            var idx = headers.indexOf(names[i]);
            if (idx >= 0 && row[idx]) return row[idx].trim();
          }
          return '';
        }
        var facilities = [], skipped = 0;
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var row = parseCSVLine(line);
          var name = col(row, 'FAC_NAME', 'PRVDR_NM', 'NAME');
          var lat = parseFloat(col(row, 'LAT_CD', 'LATITUDE', 'lat'));
          var lon = parseFloat(col(row, 'LONG_CD', 'LONGITUDE', 'lon'));
          var state = col(row, 'STATE_CD', 'STATE');
          var zip = col(row, 'ZIP_CD', 'ZIP');
          var city = col(row, 'CITY_NAME', 'CITY');
          var addr = col(row, 'ST_ADR', 'ADDRESS');
          var type = col(row, 'PRVDR_CTGRY_CD', 'PROVIDER_TYPE');
          var ccn = col(row, 'PRVDR_NUM', 'CCN');
          if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) { skipped++; continue; }
          facilities.push({
            id: 'cms_' + (ccn || i), type: 'cms', lat: lat, lon: lon,
            _facType: PROVIDER_TYPE_MAP[type] || 'clinic',
            tags: { name: name, address: addr, city: city, state: state, postcode: zip }
          });
        }
        var byState = {};
        facilities.forEach(function(f) {
          var st = f.tags.state || 'XX';
          if (!byState[st]) byState[st] = [];
          byState[st].push(f);
        });
        var output = JSON.stringify({ total: facilities.length, built: new Date().toISOString(), by_state: byState });
        await putText(getBlobUrl(sasToken, 'cms-data', 'cms_providers.json'), output, 'application/json');
        function normalizeName(n) {
          return n.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\b(the|of|and|at|a|an|for|center|centre|medical|health|care|hospital|clinic|system|services|inc|llc|corp)\b/g, '')
            .replace(/\s+/g, ' ').trim();
        }
        var lookup = {};
        facilities.forEach(function(f) {
          var st  = f.tags.state || '';
          var zip = (f.tags.postcode || '').substring(0, 5);
          var nm  = normalizeName(f.tags.name || '');
          if (!st || !nm) return;
          var key1 = st + '|' + zip + '|' + nm;
          var key2 = st + '||' + nm;
          if (!lookup[key1]) lookup[key1] = f._facType;
          if (!lookup[key2]) lookup[key2] = f._facType;
        });
        var lookupOutput = JSON.stringify({ built: new Date().toISOString(), index: lookup });
        await putText(getBlobUrl(sasToken, 'cms-data', 'cms_lookup.json'), lookupOutput, 'application/json');
        return jsonResponse(200, { success: true, facilities: facilities.length, skipped: skipped, states: Object.keys(byState).length, lookup_keys: Object.keys(lookup).length });
      } catch(err) {
        return jsonResponse(500, { error: 'CMS build failed', detail: err.message });
      }
    }

    // ── cms-data ─────────────────────────────────────────────────────────────
    if (action === 'cms-data') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'cms-data', 'cms_providers.json'));
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }, CORS_HEADERS), body: raw };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { error: 'CMS data not yet uploaded', total: 0, by_state: {} });
        }
        return jsonResponse(502, { error: 'CMS load failed', detail: err.message });
      }
    }

    // ── cms-lookup ───────────────────────────────────────────────────────────
    if (action === 'cms-lookup') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'cms-data', 'cms_lookup.json'));
        const data = JSON.parse(raw);
        const index = data.index || {};
        function normalizeName(n) {
          return n.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\b(the|of|and|at|a|an|for|center|centre|medical|health|care|hospital|clinic|system|services|inc|llc|corp)\b/g, '')
            .replace(/\s+/g, ' ').trim();
        }
        let batch;
        try { batch = JSON.parse(event.body || '[]'); } catch(e) { batch = []; }
        if (!Array.isArray(batch)) return jsonResponse(400, { error: 'Body must be JSON array' });
        const matches = {};
        batch.forEach(function(f) {
          if (!f.id || !f.name) return;
          var st  = (f.state || '').toUpperCase();
          var zip = (f.zip  || '').substring(0, 5);
          var nm  = normalizeName(f.name);
          var hit = index[st + '|' + zip + '|' + nm] || index[st + '||' + nm];
          if (hit) matches[f.id] = hit;
        });
        return jsonResponse(200, { matches: matches, queried: batch.length, matched: Object.keys(matches).length });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { matches: {}, queried: 0, matched: 0, note: 'CMS lookup index not yet built — run build-cms first' });
        }
        return jsonResponse(502, { error: 'CMS lookup failed', detail: err.message });
      }
    }

    // ── icon-list ────────────────────────────────────────────────────────────
    if (action === 'icon-list') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const systems = await readIconIndex(sasToken);
        const icons = systems.map(function(system) {
          return { system: system, blobName: 'icon-' + system };
        });
        return jsonResponse(200, { icons });
      } catch(err) {
        return jsonResponse(502, { error: 'Icon list failed', detail: err.message });
      }
    }

    // ── search-cache-get ──────────────────────────────────────────────────────
    if (action === 'search-cache-get') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const cacheKey = params.key || '';
      if (!cacheKey) return jsonResponse(400, { error: 'key param required' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'search_cache.json'));
        const cache = JSON.parse(raw);
        const entry = cache[cacheKey];
        if (!entry) return jsonResponse(200, { hit: false });
        const age = Date.now() - new Date(entry.ts).getTime();
        if (age > 30 * 24 * 60 * 60 * 1000) return jsonResponse(200, { hit: false, expired: true });
        return jsonResponse(200, { hit: true, facilities: entry.facilities });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { hit: false });
        return jsonResponse(502, { error: 'Search cache get failed', detail: err.message });
      }
    }

    // ── search-cache-set ──────────────────────────────────────────────────────
    if (action === 'search-cache-set') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch(e) { return jsonResponse(400, { error: 'Invalid JSON' }); }
      const { key, facilities } = body;
      if (!key || !facilities) return jsonResponse(400, { error: 'key and facilities required' });
      try {
        let cache = {};
        try {
          const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'search_cache.json'));
          cache = JSON.parse(raw);
        } catch(e) { /* start fresh */ }
        const now = Date.now();
        Object.keys(cache).forEach(function(k) {
          if (now - new Date(cache[k].ts).getTime() > 30 * 24 * 60 * 60 * 1000) delete cache[k];
        });
        cache[key] = { facilities: facilities, ts: new Date().toISOString() };
        await putText(getBlobUrl(sasToken, 'app-state', 'search_cache.json'), JSON.stringify(cache), 'application/json');
        return jsonResponse(200, { success: true, cached_searches: Object.keys(cache).length });
      } catch(err) {
        return jsonResponse(500, { error: 'Search cache set failed', detail: err.message });
      }
    }

    // ── referral-flows-compute ────────────────────────────────────────────────
    // Computes referral flow data for a target system against a set of competitors,
    // caches the result to Blob Storage, and returns it.
    // POST body: {
    //   targetSystem: { name, lat, lon },
    //   competitors: [ { name, marketShare, lat, lon, facilityId? }, ... ],
    //   forceRefresh: boolean  (optional — skip cache and recompute)
    // }
    if (action === 'referral-flows-compute') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch(e) {
        return jsonResponse(400, { error: 'Invalid JSON body' });
      }
      const { targetSystem, competitors, forceRefresh } = body;
      if (!targetSystem || !targetSystem.name) return jsonResponse(400, { error: 'targetSystem.name required' });
      if (!Array.isArray(competitors) || competitors.length === 0) return jsonResponse(400, { error: 'competitors array required' });

      // Build a stable cache key from target name + sorted competitor names.
      const cacheKey = 'flows_' + targetSystem.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
        + '_' + competitors.map(function(c) { return c.name; }).sort().join('_').toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 80);
      const blobName = cacheKey + '.json';

      // Try cache first unless forceRefresh requested.
      if (!forceRefresh) {
        try {
          const cached = await fetchText(getBlobUrl(sasToken, 'referral-flows', blobName));
          const parsed = JSON.parse(cached);
          // Return cached result with a flag so client knows it was cached.
          return jsonResponse(200, Object.assign({ _cached: true }, parsed));
        } catch(e) {
          // Cache miss or 404 — compute fresh below.
        }
      }

      // Compute fresh.
      const flowData = computeReferralFlows(targetSystem, competitors);

      // Persist to blob for next time.
      try {
        await putText(getBlobUrl(sasToken, 'referral-flows', blobName), JSON.stringify(flowData), 'application/json');
      } catch(e) {
        console.warn('Could not cache referral flows: ' + e.message);
        // Non-fatal — still return the computed data.
      }

      return jsonResponse(200, Object.assign({ _cached: false }, flowData));
    }

    // ── referral-flows-load ───────────────────────────────────────────────────
    // Loads a previously computed referral flow blob by target system name.
    // Useful for the standalone HubSpot modal to fetch without recomputing.
    // ?action=referral-flows-load&system=mass_general_brigham
    if (action === 'referral-flows-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const systemKey = (params.system || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (!systemKey) return jsonResponse(400, { error: 'system param required' });
      // List all blobs matching this system prefix by trying the blob directly.
      // The client is expected to pass the full cache key, or just the system name
      // to get the most recently computed flows for that system.
      const blobName = 'flows_' + systemKey + '_latest.json';
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'referral-flows', blobName));
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: raw };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(404, { error: 'No referral flows found for system: ' + systemKey + '. Run referral-flows-compute first.' });
        }
        return jsonResponse(502, { error: 'Referral flows load failed', detail: err.message });
      }
    }

    // ── referral-flows-save-latest ────────────────────────────────────────────
    // After computing flows, also write a "latest" alias blob so the standalone
    // modal can always fetch the most recent computation for a system without
    // knowing the full cache key. Called automatically by referral-flows-compute.
    // This is handled internally — not a public route.

// ── competitors-near ─────────────────────────────────────────────────────
    if (action === 'competitors-near') {
      const lat    = parseFloat(params.lat   || '0');
      const lon    = parseFloat(params.lon   || '0');
      const miles  = parseFloat(params.miles || '25');
      const target = (params.target || '').trim();
      if (!lat || !lon) return jsonResponse(400, { error: 'lat and lon required' });
      const radiusM = miles * 1609.34;
      const targetLower = target.toLowerCase();

      function tokenizeR(str) {
        var stop = new Set(['the','and','for','of','at','in','by','to','a','an']);
        return str.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/)
          .filter(function(w){ return w.length > 1 && !stop.has(w); });
      }

      try {
        if (!qhinCache || (Date.now() - qhinCacheTime) >= CACHE_TTL) {
          const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'));
          qhinCache     = JSON.parse(raw);
          qhinCacheTime = Date.now();
        }
        const facilities = Array.isArray(qhinCache) ? qhinCache : (qhinCache.facilities || []);

        let overrides = {};
        try {
          const stateRaw = await fetchText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'));
          overrides = JSON.parse(stateRaw).overrides || {};
        } catch(e) {}

        function distM(lat1, lon1, lat2, lon2) {
          const R = 6371000, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        const targetTokens = tokenizeR(target);

        function matchByPatterns(nameLow) {
          for (var i = 0; i < KNOWN_SYSTEMS.length; i++) {
            var sys = KNOWN_SYSTEMS[i];
            var sysLow = sys.name.toLowerCase();
            // Skip systems that match the target
            if (sysLow === targetLower || targetTokens.some(function(t){ return sysLow.includes(t); })) continue;
            for (var j = 0; j < sys.patterns.length; j++) {
              var pat = sys.patterns[j];
              var rx = new RegExp('(?:^|[\\s\\-,\\/])' + pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?:[\\s\\-,\\/]|$)');
              if (rx.test(nameLow) || nameLow.startsWith(pat)) return sys.name;
            }
          }
          return null;
        }

        const counts = {};
        let targetCount = 0;

        facilities.forEach(function(f) {
          const fLat = parseFloat(f.lat || (f.center && f.center.lat) || 0);
          const fLon = parseFloat(f.lon || (f.center && f.center.lon) || 0);
          if (!fLat || !fLon) return;
          if (distM(lat, lon, fLat, fLon) > radiusM) return;

          const rawName = (f.tags && f.tags.name) || f.name || '';
          const npiOrg  = (f.tags && f.tags.npi_org) || '';
          const name    = npiOrg.length > rawName.length ? npiOrg : rawName;
          const nameLow = name.toLowerCase();

          // Check override first (key format: "name|lat|lon")
          const oKey = name.toLowerCase() + '|' + fLat.toFixed(3) + '|' + fLon.toFixed(3);
          let bucket = overrides[oKey] || null;

          // Pattern matching against KNOWN_SYSTEMS
          if (!bucket) bucket = matchByPatterns(nameLow);

          // Target name matching
          if (!bucket && targetTokens.length > 0) {
            var score = 0;
            targetTokens.forEach(function(t){ if (nameLow.includes(t)) score++; });
            if (score === targetTokens.length) bucket = target;
          }

          if (!bucket) bucket = 'Independent / Community';
          if (bucket === 'Independent / Community') return;

          const bucketLow = bucket.toLowerCase();
          const isTarget = bucketLow === targetLower ||
                           bucketLow.includes(targetLower) ||
                           targetLower.includes(bucketLow.split(' ')[0]);
          if (isTarget) targetCount++;
          else counts[bucket] = (counts[bucket] || 0) + 1;
        });

        const total = targetCount + Object.values(counts).reduce((a,b)=>a+b,0);
        const competitors = Object.entries(counts)
          .sort((a,b) => b[1]-a[1])
          .slice(0, 16)
          .map(([name, count]) => ({
            name, count,
            share: total > 0 ? Math.round(count/total*100) : 0
          }));

        return jsonResponse(200, { competitors, targetCount, total, center:{lat,lon}, miles });
      } catch(err) {
        return jsonResponse(502, { error: 'competitors-near failed', detail: err.message });
      }
    }
    
    return jsonResponse(404, { error: 'Unknown action: ' + action });

  } catch(topErr) {
    return jsonResponse(500, { error: 'Router crash', detail: topErr.message, stack: topErr.stack });
  }
};
