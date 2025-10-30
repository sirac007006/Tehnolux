import express from 'express';
import bodyParser from 'body-parser';
import pg from "pg";
import dotenv from 'dotenv';
import session from 'express-session';
import bcrypt from 'bcrypt';

dotenv.config();
const app = express();
const port = 3000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());

const db = new pg.Client({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
})
db.connect();

// bcrypt hash vrednosti za sve korisnike
const ADMIN_HASH   = '$2b$12$GlMBYvuE3/jZuhfrZcagXOv.w3uVmwQEo5hdhqlpXtw9mOTbyfgfa'; // admin
const SERVIS_HASH = "$2a$12$mVDJhEzXLoGc3NcBbnN7ne4gfwuAHk8X6laD/oCCX1IViJ068j2qe";
const RADNJA_HASH  = '$2b$12$T1wLn3vutZ7VJaNsmS5q1uVqJwiT0qo1FW2DyyidxGbWSJZ20eRau'; 
const MAGACIN_HASH = '$2b$12$8yj9bdZ/C.KdDA4S5fixreK1nfPJ4wQnX9cNIRPw6eWm3S93Is19K';




// session setup
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'replace_this_in_prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: true,
    // secure: true, // enable in production with HTTPS
    maxAge: 1000 * 60 * 60 * 4 // 4 hours
  }
}));

// Simple list of public paths that don't require auth
const PUBLIC_PATHS = new Set([
  '/', '/login', '/logout',
  '/favicon.ico'
]);

// Middleware za proveru pristupa
app.use((req, res, next) => {
  const url = req.path;

  if (PUBLIC_PATHS.has(url) || url.startsWith('/public') || url.startsWith('/api/public')) {
    return next();
  }

  if (!req.session || !req.session.role) {
    return res.redirect('/');
  }

  // admin role ima pun pristup
  if (req.session.role === 'admin') return next();

  // servis role ima ograničen pristup
  if (req.session.role === 'servis') {
    if (url === '/servis' || url.startsWith('/servis/')) return next();
    return res.status(403).send('Pristup zabranjen za servis nalog.');
  }

  return res.status(403).send('Pristup zabranjen.');
});

// Login page
app.get('/', (req, res) => {
  if (req.session && req.session.role === 'admin') return res.redirect('/partneri');
  if (req.session && req.session.role === 'servis') return res.redirect('/servis');
  return res.render('login.ejs', { message: null });
});

// Login handler
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.render('login.ejs', { message: 'Korisničko ime i lozinka su obavezni.' });
  }

  try {
    // --- ADMIN ---
    if (username === 'admin') {
      const match = await bcrypt.compare(password, ADMIN_HASH);
      if (match) {
        req.session.role = 'admin';
        req.session.username = 'admin';
        return res.redirect('/partneri');
      }
    }

    // --- RADNJA ---
    if (username === 'radnja') {
      const match = await bcrypt.compare(password, RADNJA_HASH);
      if (match) {
        req.session.role = 'admin';
        req.session.username = 'radnja';
        return res.redirect('/partneri');
      }
    }

    // --- MAGACIN ---
    if (username === 'magacin') {
      const match = await bcrypt.compare(password, MAGACIN_HASH);
      if (match) {
        req.session.role = 'admin';
        req.session.username = 'magacin';
        return res.redirect('/partneri');
      }
    }

    // --- SERVISERI (dinamički iz baze) ---
    const normalized = String(username).trim().toLowerCase();

    const query = `
      SELECT id, ime_servisera
      FROM serviseri
      WHERE LOWER(REPLACE(ime_servisera, ' ', '_')) = $1
      LIMIT 1
    `;
    const result = await db.query(query, [normalized]);
    console.log('Broj pronađenih servisera:', result.rows.length);
if (result.rows.length > 0) {
  const serviser = result.rows[0];
  console.log('Pronađen serviser:', serviser.ime_servisera);

  const match = await bcrypt.compare(password, SERVIS_HASH);
  console.log('Rezultat bcrypt.compare:', match);

  if (match) {
    req.session.role = 'servis';
    req.session.username = serviser.ime_servisera;
    return res.redirect('/servis');
  }
}


    if (result.rows.length > 0) {
      const serviser = result.rows[0];
       console.log('Uneta lozinka:', password);
  console.log('Hash u kodu:', SERVIS_HASH);
      const match = await bcrypt.compare(password, SERVIS_HASH);
      if (match) {
        req.session.role = 'servis';
        req.session.username = serviser.ime_servisera;
        return res.redirect('/servis');
      }
    }

    // Ako ništa nije prošlo:
    return res.render('login.ejs', { message: 'Neispravno korisničko ime ili lozinka.' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Greška na serveru prilikom prijave.');
  }
});


// Logout (GET)
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('sid');
    return res.redirect('/');
  });
});

// Logout (POST)
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('sid');
    return res.redirect('/');
  });
});
// =============================================================================
// KARTICA KUPCA ROUTES - SA SALDO KALKULACIJAMA
// =============================================================================

// GET - Kartica kupca stranica
app.get("/karticekupca", async (req, res) => {
  try {
    // Fetch all partners from partneri table
    const partneri = (await db.query(
      'SELECT * FROM "partneri" ORDER BY "Naziv_partnera"'
    )).rows;

    res.render("karticakupca.ejs", { partneri });
  } catch (error) {
    console.error("Error fetching partneri for kartica kupca:", error);
    res.status(500).send("Greška pri dohvatanju partnera.");
  }
});

// API route za saldos svih partnera
// API route za saldos svih partnera - ISPRAVLJENA LOGIKA
app.get("/api/karticekupca/saldos", async (req, res) => {
  try {
    const { datum_od, datum_do } = req.query;
    
    // Pripremi WHERE klauzulu za filtriranje po datumu
    let dateFilterOtpremnice = '';
    let dateFilterUplate = '';
    let queryParams = [];
    let paramCount = 0;
    
    if (datum_od) {
      paramCount++;
      dateFilterOtpremnice += ` AND d.datum >= $${paramCount}`;
      dateFilterUplate += ` AND u.datum >= $${paramCount}`;
      queryParams.push(datum_od);
    }
    
    if (datum_do) {
      paramCount++;
      dateFilterOtpremnice += ` AND d.datum <= $${paramCount}`;
      dateFilterUplate += ` AND u.datum <= $${paramCount}`;
      queryParams.push(datum_do);
    }

    // Dobij sume otpremnica za sve partnere
    const otpremniceQuery = `
      SELECT 
        p."Sifra",
        p."Naziv_partnera",
        COALESCE(SUM(d.iznos_sa_pdv), 0) as ukupne_otpremnice
      FROM "partneri" p
      LEFT JOIN "dokumenti" d ON d.partner = p."Naziv_partnera" 
        AND d.tip_dokumenta LIKE 'otpremnica%'${dateFilterOtpremnice}
      GROUP BY p."Sifra", p."Naziv_partnera"
    `;

    // Dobij sume uplata za sve partnere
    const uplateQuery = `
      SELECT 
        p."Sifra",
        p."Naziv_partnera",
        COALESCE(SUM(u.iznos), 0) as ukupne_uplate
      FROM "partneri" p
      LEFT JOIN "uplate" u ON u.kupac = p."Naziv_partnera" 
        AND u.status = 'primljena'${dateFilterUplate}
      GROUP BY p."Sifra", p."Naziv_partnera"
    `;

    const [otpremniceResult, uplateResult] = await Promise.all([
      db.query(otpremniceQuery, queryParams),
      db.query(uplateQuery, queryParams)
    ]);

    // Kombinuj rezultate i izračunaj saldo
    const saldos = [];
    const otpremniceMap = new Map();
    const uplateMap = new Map();

    otpremniceResult.rows.forEach(row => {
      otpremniceMap.set(row.Sifra, parseFloat(row.ukupne_otpremnice) || 0);
    });

    uplateResult.rows.forEach(row => {
      uplateMap.set(row.Sifra, parseFloat(row.ukupne_uplate) || 0);
    });

    // Kreiraj saldo za svaki partner - ISPRAVLJENA LOGIKA
    otpremniceResult.rows.forEach(row => {
      const otpremnice = otpremniceMap.get(row.Sifra) || 0;
      const uplate = uplateMap.get(row.Sifra) || 0;
      const saldo = uplate - otpremnice; // UPLATE - OTPREMNICE (pozitivno = kredit kupca)

      saldos.push({
        sifra: row.Sifra,
        naziv: row.Naziv_partnera,
        otpremnice: otpremnice,
        uplate: uplate,
        saldo: saldo
      });
    });

    res.json({
      success: true,
      saldos: saldos
    });

  } catch (error) {
    console.error("Error calculating partner saldos:", error);
    res.json({
      success: false,
      message: "Greška pri kalkulaciji saldova partnera"
    });
  }
});
// API route to get partner details with otpremnice and uplate
app.get("/api/karticekupca/partner/:id", async (req, res) => {
  try {
    const partnerId = req.params.id;
    const { datum_od, datum_do } = req.query;

    console.log(`Fetching partner details for ID: ${partnerId}`);

    // 1️⃣ Uzimamo podatke o partneru po šifri
    const partnerResult = await db.query(
      'SELECT * FROM "partneri" WHERE "Sifra" = $1',
      [partnerId]
    );

    if (partnerResult.rows.length === 0) {
      return res.json({ success: false, message: "Partner nije pronađen" });
    }

    const partner = partnerResult.rows[0];
    console.log(`Partner found: ${partner.Naziv_partnera}`);

    // Pripremi WHERE klauzulu za filtriranje po datumu
    let dateFilter = '';
    let queryParams = [partner.Naziv_partnera];
    let paramCount = 1;
    
    if (datum_od) {
      paramCount++;
      dateFilter += ` AND datum >= $${paramCount}`;
      queryParams.push(datum_od);
    }
    
    if (datum_do) {
      paramCount++;
      dateFilter += ` AND datum <= $${paramCount}`;
      queryParams.push(datum_do);
    }

    // 2️⃣ Tražimo SAMO otpremnice partnera
    const otpremniceResult = await db.query(
      `SELECT 
        "id",
        "datum",
        "partner",
        "tip_dokumenta",
        "naziv_artikla",
        "kolicina",
        "iznos_bez_pdv",
        "iznos_sa_pdv",
        "pdv_iznos",
        "rabat",
        "komercijalist_id",
        "komercijalist_ime",
        "magacin"
       FROM "dokumenti"
       WHERE "partner" = $1 
       AND "tip_dokumenta" LIKE 'otpremnica%'${dateFilter}
       ORDER BY "datum" DESC, "id" DESC`,
      queryParams
    );

    console.log(`Found ${otpremniceResult.rows.length} otpremnice for partner ${partner.Naziv_partnera}`);

    // 3️⃣ Tražimo uplate partnera
    const uplateResult = await db.query(
      `SELECT 
        "id",
        "datum",
        "kupac",
        "iznos",
        "nacin",
        "status",
        "dokument",
        "komercijalist",
        "napomene"
       FROM "uplate"
       WHERE "kupac" = $1 
       AND "status" = 'primljena'${dateFilter}
       ORDER BY "datum" DESC, "id" DESC`,
      queryParams
    );

    console.log(`Found ${uplateResult.rows.length} uplate for partner ${partner.Naziv_partnera}`);

    const otpremnice = otpremniceResult.rows;
    const uplate = uplateResult.rows;

    // 4️⃣ Vraćamo partnera sa otpremnicama i uplatama
    res.json({
      success: true,
      partner,
      otpremnice,
      uplate,
    });
  } catch (error) {
    console.error("Error fetching partner details:", error);
    res.json({
      success: false,
      message: "Greška pri dohvatanju podataka partnera",
    });
  }
});

// API route for filtered search of partners
app.get("/api/karticekupca/search", async (req, res) => {
  try {
    const { searchTerm, dateFrom, dateTo } = req.query;
    
    let query = 'SELECT DISTINCT p.* FROM "partneri" p';
    let params = [];
    let whereConditions = [];
    let paramCount = 0;

    // Dodaj pretragu po imenu, gradu, PIB ili šifri
    if (searchTerm) {
      paramCount++;
      whereConditions.push(`(
        LOWER(p."Naziv_partnera") LIKE LOWER($${paramCount}) OR 
        LOWER(p."Grad") LIKE LOWER($${paramCount}) OR 
        CAST(p."Sifra" AS TEXT) LIKE $${paramCount} OR
        LOWER(p."PIB") LIKE LOWER($${paramCount})
      )`);
      params.push(`%${searchTerm}%`);
    }

    // Ako ima datumski filter, join sa dokumenti ili uplate
    if (dateFrom || dateTo) {
      query += ` LEFT JOIN "dokumenti" d ON p."Naziv_partnera" = d."partner" 
                 LEFT JOIN "uplate" u ON p."Naziv_partnera" = u."kupac"`;
      
      if (dateFrom) {
        paramCount++;
        whereConditions.push(`(d."datum" >= $${paramCount} OR u."datum" >= $${paramCount})`);
        params.push(dateFrom);
      }
      
      if (dateTo) {
        paramCount++;
        whereConditions.push(`(d."datum" <= $${paramCount} OR u."datum" <= $${paramCount})`);
        params.push(dateTo);
      }
    }

    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }

    query += ' ORDER BY p."Naziv_partnera"';

    const result = await db.query(query, params);
    
    res.json({
      success: true,
      partneri: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error("Error searching partners:", error);
    res.json({ success: false, message: "Greška pri pretraživanju partnera" });
  }
});

// API route to get kartica kupca statistics
app.get("/api/karticekupca/stats", async (req, res) => {
  try {
    const { datum_od, datum_do } = req.query;
    
    // Pripremi WHERE klauzulu za filtriranje po datumu
    let dateFilter = '';
    let queryParams = [];
    let paramCount = 0;
    
    if (datum_od) {
      paramCount++;
      dateFilter += ` AND datum >= $${paramCount}`;
      queryParams.push(datum_od);
    }
    
    if (datum_do) {
      paramCount++;
      dateFilter += ` AND datum <= $${paramCount}`;
      queryParams.push(datum_do);
    }

    // Statistike otpremnica
    const otpremniceStats = await db.query(`
      SELECT 
        COUNT(*) as broj_otpremnica,
        COUNT(DISTINCT partner) as partneri_sa_otpremnicama,
        SUM(iznos_sa_pdv) as ukupne_otpremnice,
        AVG(iznos_sa_pdv) as prosecna_otpremnica
      FROM "dokumenti" 
      WHERE tip_dokumenta LIKE 'otpremnica%'${dateFilter}
    `, queryParams);

    // Statistike uplata
    const uplateStats = await db.query(`
      SELECT 
        COUNT(*) as broj_uplata,
        COUNT(DISTINCT kupac) as partneri_sa_uplatama,
        SUM(iznos) as ukupne_uplate,
        AVG(iznos) as prosecna_uplata
      FROM "uplate" 
      WHERE status = 'primljena'${dateFilter}
    `, queryParams);

    // Ukupan broj partnera
    const partnerStats = await db.query('SELECT COUNT(*) as ukupno_partnera FROM "partneri"');

    const stats = {
      ukupno_partnera: parseInt(partnerStats.rows[0].ukupno_partnera) || 0,
      broj_otpremnica: parseInt(otpremniceStats.rows[0].broj_otpremnica) || 0,
      partneri_sa_otpremnicama: parseInt(otpremniceStats.rows[0].partneri_sa_otpremnicama) || 0,
      ukupne_otpremnice: parseFloat(otpremniceStats.rows[0].ukupne_otpremnice) || 0,
      prosecna_otpremnica: parseFloat(otpremniceStats.rows[0].prosecna_otpremnica) || 0,
      broj_uplata: parseInt(uplateStats.rows[0].broj_uplata) || 0,
      partneri_sa_uplatama: parseInt(uplateStats.rows[0].partneri_sa_uplatama) || 0,
      ukupne_uplate: parseFloat(uplateStats.rows[0].ukupne_uplate) || 0,
      prosecna_uplata: parseFloat(uplateStats.rows[0].prosecna_uplata) || 0,
      ukupan_saldo: (parseFloat(otpremniceStats.rows[0].ukupne_otpremnice) || 0) - (parseFloat(uplateStats.rows[0].ukupne_uplate) || 0),
      date_range: {
        datum_od: datum_od || null,
        datum_do: datum_do || null
      }
    };

    res.json({
      success: true,
      stats: stats
    });

  } catch (error) {
    console.error("Error fetching kartica kupca stats:", error);
    res.json({ success: false, message: "Greška pri dohvatanju statistika kartice kupca" });
  }
});

// API route za export kartice kupca u CSV
app.get("/api/karticekupca/export", async (req, res) => {
  try {
    const { datum_od, datum_do, format = 'csv' } = req.query;
    
    // Dobij saldos podatke
    const saldosResponse = await fetch(`${req.protocol}://${req.get('host')}/api/karticekupca/saldos?datum_od=${datum_od || ''}&datum_do=${datum_do || ''}`);
    const saldosData = await saldosResponse.json();
    
    if (!saldosData.success) {
      return res.status(500).json({ error: "Greška pri dohvatanju podataka" });
    }

    if (format === 'csv') {
      let csv = 'Šifra,Naziv partnera,Ukupne otpremnice (€),Ukupne uplate (€),Saldo (€)\n';
      
      saldosData.saldos.forEach(partner => {
        const row = [
          `"${partner.sifra}"`,
          `"${partner.naziv}"`,
          partner.otpremnice.toFixed(2),
          partner.uplate.toFixed(2),
          partner.saldo.toFixed(2)
        ].join(',');
        csv += row + '\n';
      });

      const fileName = `kartica_kupca_${datum_od || 'sve'}_${datum_do || 'sve'}.csv`;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send('\ufeff' + csv);
    } else {
      res.json({
        success: true,
        data: saldosData.saldos,
        period: { datum_od, datum_do }
      });
    }

  } catch (error) {
    console.error("Error exporting kartica kupca:", error);
    res.status(500).json({ error: "Greška pri eksportu kartice kupca." });
  }
});

// API route za Top 10 partnera po saldu
app.get("/api/karticekupca/top-partneri", async (req, res) => {
  try {
    const { datum_od, datum_do, tip = 'pozitivni', limit = 10 } = req.query;
    
    // Koristi postojeći saldos endpoint
    const saldosResponse = await fetch(`${req.protocol}://${req.get('host')}/api/karticekupca/saldos?datum_od=${datum_od || ''}&datum_do=${datum_do || ''}`);
    const saldosData = await saldosResponse.json();
    
    if (!saldosData.success) {
      return res.status(500).json({ error: "Greška pri dohvatanju podataka" });
    }

    let filteredPartneri = saldosData.saldos;
    
    // Filtriraj partnere na osnovu tipa
    if (tip === 'pozitivni') {
      filteredPartneri = filteredPartneri.filter(p => p.saldo > 0);
      filteredPartneri.sort((a, b) => b.saldo - a.saldo); // Najveći pozitivni saldo prvo
    } else if (tip === 'negativni') {
      filteredPartneri = filteredPartneri.filter(p => p.saldo < 0);
      filteredPartneri.sort((a, b) => a.saldo - b.saldo); // Najmanji negativni saldo prvo
    } else {
      // svi partneri sortirani po apsolutnoj vrednosti salda
      filteredPartneri.sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
    }

    // Ograniči na limit
    const topPartneri = filteredPartneri.slice(0, parseInt(limit));

    res.json({
      success: true,
      topPartneri: topPartneri,
      tip: tip,
      count: topPartneri.length,
      period: { datum_od, datum_do }
    });

  } catch (error) {
    console.error("Error fetching top partneri:", error);
    res.json({ success: false, message: "Greška pri dohvatanju top partnera" });
  }
});

// API route za partnere sa dugovima (negativan saldo)
app.get("/api/karticekupca/dugovanja", async (req, res) => {
  try {
    const { datum_od, datum_do, min_dugovanje = 0 } = req.query;
    
    // Koristi postojeći saldos endpoint
    const saldosResponse = await fetch(`${req.protocol}://${req.get('host')}/api/karticekupca/saldos?datum_od=${datum_od || ''}&datum_do=${datum_do || ''}`);
    const saldosData = await saldosResponse.json();
    
    if (!saldosData.success) {
      return res.status(500).json({ error: "Greška pri dohvatanju podataka" });
    }

    // Filtriraj partnere sa negativnim saldom
    const dugovanja = saldosData.saldos
      .filter(p => p.saldo < 0 && Math.abs(p.saldo) >= parseFloat(min_dugovanje))
      .sort((a, b) => a.saldo - b.saldo); // Najveće dugovanje prvo

    const ukupnoDugovanje = dugovanja.reduce((sum, p) => sum + Math.abs(p.saldo), 0);

    res.json({
      success: true,
      dugovanja: dugovanja,
      ukupno_dugovanje: ukupnoDugovanje,
      broj_partnera_sa_dugom: dugovanja.length,
      min_dugovanje: parseFloat(min_dugovanje),
      period: { datum_od, datum_do }
    });

  } catch (error) {
    console.error("Error fetching dugovanja:", error);
    res.json({ success: false, message: "Greška pri dohvatanju dugovanja" });
  }
});

// API route za detaljnu analizu partnera
app.get("/api/karticekupca/analiza/:partnerId", async (req, res) => {
  try {
    const { partnerId } = req.params;
    const { datum_od, datum_do } = req.query;

    // Dobij osnovne podatke partnera
    const partnerResult = await db.query(
      'SELECT * FROM "partneri" WHERE "Sifra" = $1',
      [partnerId]
    );

    if (partnerResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Partner nije pronađen" });
    }

    const partner = partnerResult.rows[0];

    // Pripremi date filter
    let dateFilter = '';
    let queryParams = [partner.Naziv_partnera];
    let paramCount = 1;
    
    if (datum_od) {
      paramCount++;
      dateFilter += ` AND datum >= $${paramCount}`;
      queryParams.push(datum_od);
    }
    
    if (datum_do) {
      paramCount++;
      dateFilter += ` AND datum <= $${paramCount}`;
      queryParams.push(datum_do);
    }

    // Detaljne statistike otpremnica
    const otpremniceAnaliza = await db.query(`
      SELECT 
        COUNT(*) as broj_otpremnica,
        SUM(iznos_sa_pdv) as ukupne_otpremnice,
        AVG(iznos_sa_pdv) as prosecna_otpremnica,
        MIN(iznos_sa_pdv) as najmanja_otpremnica,
        MAX(iznos_sa_pdv) as najveca_otpremnica,
        MIN(datum) as prva_otpremnica,
        MAX(datum) as poslednja_otpremnica,
        COUNT(DISTINCT EXTRACT(MONTH FROM datum)) as aktivnih_meseci
      FROM "dokumenti" 
      WHERE partner = $1 
      AND tip_dokumenta LIKE 'otpremnica%'${dateFilter}
    `, queryParams);

    // Detaljne statistike uplata
    const uplateAnaliza = await db.query(`
      SELECT 
        COUNT(*) as broj_uplata,
        SUM(iznos) as ukupne_uplate,
        AVG(iznos) as prosecna_uplata,
        MIN(iznos) as najmanja_uplata,
        MAX(iznos) as najveca_uplata,
        MIN(datum) as prva_uplata,
        MAX(datum) as poslednja_uplata,
        COUNT(DISTINCT nacin) as razlicitih_nacina_placanja
      FROM "uplate" 
      WHERE kupac = $1 
      AND status = 'primljena'${dateFilter}
    `, queryParams);

    // Mesečni pregled aktivnosti
    const mesecniPregled = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datum) as godina,
        EXTRACT(MONTH FROM datum) as mesec,
        TO_CHAR(datum, 'MM/YYYY') as period,
        COUNT(*) as broj_dokumenata,
        SUM(iznos_sa_pdv) as ukupno
      FROM "dokumenti" 
      WHERE partner = $1 
      AND tip_dokumenta LIKE 'otpremnica%'${dateFilter}
      GROUP BY EXTRACT(YEAR FROM datum), EXTRACT(MONTH FROM datum), TO_CHAR(datum, 'MM/YYYY')
      ORDER BY godina DESC, mesec DESC
      LIMIT 12
    `, queryParams);

    const otpremnice = otpremniceAnaliza.rows[0];
    const uplate = uplateAnaliza.rows[0];
    const saldo = (parseFloat(otpremnice.ukupne_otpremnice) || 0) - (parseFloat(uplate.ukupne_uplate) || 0);

    const analiza = {
      partner: partner,
      saldo: saldo,
      otpremnice: {
        broj: parseInt(otpremnice.broj_otpremnica) || 0,
        ukupno: parseFloat(otpremnice.ukupne_otpremnice) || 0,
        prosek: parseFloat(otpremnice.prosecna_otpremnica) || 0,
        minimum: parseFloat(otpremnice.najmanja_otpremnica) || 0,
        maksimum: parseFloat(otpremnice.najveca_otpremnica) || 0,
        prva: otpremnice.prva_otpremnica,
        poslednja: otpremnice.poslednja_otpremnica,
        aktivnih_meseci: parseInt(otpremnice.aktivnih_meseci) || 0
      },
      uplate: {
        broj: parseInt(uplate.broj_uplata) || 0,
        ukupno: parseFloat(uplate.ukupne_uplate) || 0,
        prosek: parseFloat(uplate.prosecna_uplata) || 0,
        minimum: parseFloat(uplate.najmanja_uplata) || 0,
        maksimum: parseFloat(uplate.najveca_uplata) || 0,
        prva: uplate.prva_uplata,
        poslednja: uplate.poslednja_uplata,
        razlicitih_nacina: parseInt(uplate.razlicitih_nacina_placanja) || 0
      },
      mesecni_pregled: mesecniPregled.rows,
      period: { datum_od, datum_do }
    };

    res.json({
      success: true,
      analiza: analiza
    });

  } catch (error) {
    console.error("Error fetching partner analysis:", error);
    res.json({ success: false, message: "Greška pri analizi partnera" });
  }
});
// PARTNERI ROUTES - UPDATED sa Rabat kolonom
app.get("/partneri", async(req, res) => {
    try {
        const partneri = (await db.query(
            'SELECT * FROM "partneri" ORDER BY "Naziv_partnera"'
        )).rows;
        res.render("partneri.ejs", { partneri });
    } catch (error) {
        console.error("Error fetching partneri:", error);
        res.status(500).send("Greška pri dohvatanju partnera.");
    }
});

// API endpoint za partnere (JSON response) - IMPROVED
app.get("/api/partneri", async(req, res) => {
    try {
        const partneri = (await db.query(
            'SELECT * FROM "partneri" ORDER BY "Naziv_partnera"'
        )).rows;
        
        // Debug log to see the structure of data
        console.log('API Partneri response:', partneri.length, 'partners found');
        if (partneri.length > 0) {
            console.log('Sample partner structure:', Object.keys(partneri[0]));
        }
        
        res.json(partneri);
    } catch (error) {
        console.error("Error fetching partneri:", error);
        res.status(500).json({ error: "Greška pri dohvatanju partnera." });
    }
});

// Uzmi pojedinačni partner po Sifri - NEW
app.get("/partneri/:Sifra", async(req, res) => {
    const Sifra = req.params.Sifra;
    try {
        const result = await db.query('SELECT * FROM "partneri" WHERE "Sifra" = $1', [Sifra]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Partner nije pronađen' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching partner:", error);
        res.status(500).json({ error: "Greška pri dohvatanju partnera." });
    }
});

// Dodaj partnera - UPDATED sa Rabat i poboljšanom validacijom
app.post("/partneri", async (req, res) => {
    const p = req.body;
    try {
        // Validacija obaveznih polja
        if (!p.Naziv_partnera || !p.Sifra) {
            return res.status(400).json({ error: "Naziv partnera i šifra su obavezni." });
        }

        // Proveri da li šifra već postoji
        const existingPartner = await db.query('SELECT "Sifra" FROM "partneri" WHERE "Sifra" = $1', [p.Sifra]);
        if (existingPartner.rows.length > 0) {
            return res.status(400).json({ error: "Partner sa ovom šifrom već postoji." });
        }

        // Parsiranje rabata
        const rabat = parseFloat(p.Rabat || p.rabat) || null;
        if (rabat !== null && (rabat < 0 || rabat > 100)) {
            return res.status(400).json({ error: "Rabat mora biti između 0 i 100%." });
        }

        await db.query(
            `INSERT INTO "partneri"
            ("Sifra", "Naziv_partnera", "Grad", "PIB", "Adresa", "Telefon", "Fax", "E_mail", "Lice1", "Lice2", "rabat")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                p.Sifra, 
                p.Naziv_partnera, 
                p.Grad || null, 
                p.PIB || null, 
                p.Adresa || null, 
                p.Telefon || null, 
                p.Fax || null, 
                p.E_mail || p.Email || null, 
                p.Lice1 || p.Kontakt_osoba1 || null, 
                p.Lice2 || p.Kontakt_osoba2 || null, 
                rabat
            ]
        );
        res.status(201).json({ message: "Partner je uspešno dodat.", sifra: p.Sifra });
    } catch (error) {
        console.error("Error adding partner:", error);
        if (error.code === '23505') { // PostgreSQL unique violation
            res.status(400).json({ error: "Partner sa ovom šifrom već postoji." });
        } else {
            res.status(500).json({ error: "Greška pri dodavanju partnera: " + error.message });
        }
    }
});

// Izmeni partnera - UPDATED sa Rabat i poboljšanom validacijom + DISCOUNT UPDATE SUPPORT
app.put("/partneri/:Sifra", async (req, res) => {
    const Sifra = req.params.Sifra;
    const p = req.body;
    try {
        console.log(`Updating partner ${Sifra} with data:`, p); // Debug log
        
        // Validacija obaveznih polja
        if (!p.Naziv_partnera) {
            return res.status(400).json({ error: "Naziv partnera je obavezan." });
        }

        // Proveri da li partner postoji
        const existingPartner = await db.query('SELECT * FROM "partneri" WHERE "Sifra" = $1', [Sifra]);
        if (existingPartner.rows.length === 0) {
            return res.status(404).json({ error: "Partner nije pronađen." });
        }

        const existing = existingPartner.rows[0];
        console.log(`Existing partner data:`, existing); // Debug log

        // Parsiranje rabata - podržava oba naziva kolona
        const rabat = parseFloat(p.Rabat || p.rabat) || null;
        if (rabat !== null && (rabat < 0 || rabat > 100)) {
            return res.status(400).json({ error: "Rabat mora biti između 0 i 100%." });
        }

        console.log(`New discount value: ${rabat}`); // Debug log

        // Koristi postojeće vrednosti ako nisu prosleđene nove
        const updatedData = {
            naziv: p.Naziv_partnera,
            grad: p.Grad || existing.Grad || null,
            pib: p.PIB || existing.PIB || null,
            adresa: p.Adresa || existing.Adresa || null,
            telefon: p.Telefon || existing.Telefon || null,
            fax: p.Fax || existing.Fax || null,
            email: p.E_mail || p.Email || existing.E_mail || null,
            lice1: p.Lice1 || p.Kontakt_osoba1 || existing.Lice1 || null,
            lice2: p.Lice2 || p.Kontakt_osoba2 || existing.Lice2 || null,
            rabat: rabat !== null ? rabat : existing.rabat
        };

        await db.query(
            `UPDATE "partneri" SET 
                "Naziv_partnera"=$1, "Grad"=$2, "PIB"=$3, "Adresa"=$4, 
                "Telefon"=$5, "Fax"=$6, "E_mail"=$7, "Lice1"=$8, "Lice2"=$9, "rabat"=$10
             WHERE "Sifra"=$11`,
            [
                updatedData.naziv,
                updatedData.grad,
                updatedData.pib,
                updatedData.adresa,
                updatedData.telefon,
                updatedData.fax,
                updatedData.email,
                updatedData.lice1,
                updatedData.lice2,
                updatedData.rabat,
                Sifra
            ]
        );

        console.log(`Partner ${Sifra} successfully updated with discount: ${updatedData.rabat}%`); // Debug log
        
        res.json({ 
            message: "Partner je uspešno ažuriran.",
            discount: updatedData.rabat
        });
    } catch (error) {
        console.error("Error updating partner:", error);
        res.status(500).json({ error: "Greška pri izmeni partnera: " + error.message });
    }
});

// Obrisi partnera - IMPROVED sa boljim error handling
app.delete("/partneri/:Sifra", async (req, res) => {
    const Sifra = req.params.Sifra;
    try {
        // Proveri da li partner postoji
        const existingPartner = await db.query('SELECT "Sifra" FROM "partneri" WHERE "Sifra" = $1', [Sifra]);
        if (existingPartner.rows.length === 0) {
            return res.status(404).json({ error: "Partner nije pronađen." });
        }

        await db.query('DELETE FROM "partneri" WHERE "Sifra"=$1', [Sifra]);
        res.json({ message: "Partner je uspešno obrisan." });
    } catch (error) {
        console.error("Error deleting partner:", error);
        if (error.code === '23503') { // PostgreSQL foreign key violation
            res.status(400).json({ error: "Ne možete obrisati partnera koji se koristi u drugim dokumentima." });
        } else {
            res.status(500).json({ error: "Greška pri brisanju partnera." });
        }
    }
});

// NEW: Special endpoint for updating only partner discount (optimized for otpremnica/predracun)
app.patch("/partneri/:Sifra/discount", async (req, res) => {
    const Sifra = req.params.Sifra;
    const { discount } = req.body;
    
    try {
        console.log(`Updating discount for partner ${Sifra} to ${discount}%`); // Debug log
        
        // Validacija rabata
        const rabat = parseFloat(discount);
        if (isNaN(rabat) || rabat < 0 || rabat > 100) {
            return res.status(400).json({ error: "Rabat mora biti između 0 i 100%." });
        }

        // Proveri da li partner postoji
        const existingPartner = await db.query('SELECT "Sifra" FROM "partneri" WHERE "Sifra" = $1', [Sifra]);
        if (existingPartner.rows.length === 0) {
            return res.status(404).json({ error: "Partner nije pronađen." });
        }

        // Ažuriraj samo rabat
        await db.query('UPDATE "partneri" SET "rabat" = $1 WHERE "Sifra" = $2', [rabat, Sifra]);
        
        console.log(`Successfully updated discount for partner ${Sifra} to ${rabat}%`); // Debug log
        
        res.json({ 
            message: "Rabat partnera je uspešno ažuriran.",
            sifra: Sifra,
            newDiscount: rabat
        });
    } catch (error) {
        console.error("Error updating partner discount:", error);
        res.status(500).json({ error: "Greška pri ažuriranju rabata partnera: " + error.message });
    }
});

app.get("/karticekupca", async (req, res) => {
    res.render("karticakupca.ejs");
});

app.get("/artikli", async (req, res) => {
    try {
        // Prvo izvrši automatsku sinhronizaciju cena
        try {
            const syncResponse = await fetch(`http://localhost:${port}/api/artikli/sync-prices-auto`);
            if (syncResponse.ok) {
                const syncData = await syncResponse.json();
                console.log('Auto-sync result:', syncData.message);
            }
        } catch (syncError) {
            console.log('Auto-sync skipped or failed:', syncError.message);
        }

        // Zatim uzmi ažurirane podatke
        const artikli = (await db.query(
            'SELECT * FROM "artikli" ORDER BY "sifra"'
        )).rows;
        
        res.render("artikli.ejs", { artikli });
    } catch (error) {
        console.error("Error fetching artikli:", error);
        res.status(500).send("Greška pri dohvatanju artikala.");
    }
});
app.get("/api/artikli", async (req, res) => {
    try {
        // Prvo izvrši automatsku sinhronizaciju
        try {
            const syncResponse = await fetch(`http://localhost:${port}/api/artikli/sync-prices-auto`);
            if (syncResponse.ok) {
                const syncData = await syncResponse.json();
                console.log('API Auto-sync result:', syncData.message);
            }
        } catch (syncError) {
            console.log('API Auto-sync skipped:', syncError.message);
        }

        const artikli = (await db.query(
            'SELECT * FROM "artikli" ORDER BY "sifra"'
        )).rows;
        res.json(artikli);
    } catch (error) {
        console.error("Error fetching artikli:", error);
        res.status(500).json({ error: "Greška pri dohvatanju artikala." });
    }
});

// Get single article by SIFRA
app.get("/artikli/:sifra", async (req, res) => {
    try {
        const { sifra } = req.params;
        
        // Prvo pokušaj da dobiješ podatke iz lager tabele (glavni izvor cene)
        const lagerResult = await db.query(
            'SELECT sifra, naziv, "JM" as jm, "cena_sa_PDV" as cena FROM lager WHERE sifra = $1',
            [sifra]
        );

        if (lagerResult.rows.length > 0) {
            const lagerArtikal = lagerResult.rows[0];
            
            // Proveri da li postoji u artikli tabeli i uzmi vrstu artikla
            const artikalResult = await db.query(
                'SELECT vrsta FROM artikli WHERE sifra = $1',
                [sifra]
            );
            
            const artikal = {
                sifra: lagerArtikal.sifra,
                naziv: lagerArtikal.naziv,
                jm: lagerArtikal.jm,
                cena: parseFloat(lagerArtikal.cena) || 0,
                vrsta: artikalResult.rows.length > 0 ? artikalResult.rows[0].vrsta : 'Ostalo'
            };
            
            // Ažuriraj artikli tabelu sa cenom iz lager tabele
            if (artikalResult.rows.length > 0) {
                await db.query(
                    'UPDATE artikli SET cena = $1 WHERE sifra = $2',
                    [artikal.cena, sifra]
                );
            }
            
            return res.json(artikal);
        } else {
            // Ako ne postoji u lageru, pokušaj iz artikli tabele
            const artikalResult = await db.query(
                'SELECT * FROM artikli WHERE sifra = $1',
                [sifra]
            );

            if (artikalResult.rows.length === 0) {
                return res.status(404).json({ error: "Artikal nije pronađen." });
            }

            return res.json(artikalResult.rows[0]);
        }
    } catch (error) {
        console.error("Error fetching article:", error);
        res.status(500).json({ error: "Greška pri dohvatanju artikla." });
    }
});

app.post("/artikli", async (req, res) => {
    try {
        const { sifra, naziv, jm, cena, vrsta } = req.body;

        if (!sifra || !naziv || !jm || !vrsta) {
            return res.status(400).json({
                error: "Sva obavezna polja moraju biti popunjena."
            });
        }

        const existingArticle = await db.query(
            'SELECT "sifra" FROM "artikli" WHERE "sifra" = $1',
            [sifra]
        );

        if (existingArticle.rows.length > 0) {
            return res.status(400).json({
                error: "Artikal sa ovom šifrom već postoji."
            });
        }

        const priceValue = cena ? parseFloat(cena) : 0;
        if (isNaN(priceValue) || priceValue < 0) {
            return res.status(400).json({
                error: "Cena mora biti validni pozitivni broj."
            });
        }

        await db.query('BEGIN');

        // Ubaci u artikli tabelu
        const result = await db.query(
            'INSERT INTO "artikli" ("sifra", "naziv", "jm", "cena", "vrsta") VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [sifra.trim(), naziv.trim(), jm.trim(), priceValue, vrsta.trim()]
        );

        // Izračunaj cenu bez PDV-a (cena_sa_PDV / 1.21)
        const cenaBezPDV = priceValue / 1.21;

        // Sinhronizuj sa lager tabelom - SA automatskim izračunavanjem cene bez PDV-a
        const existingLager = await db.query(
            'SELECT sifra FROM lager WHERE sifra = $1',
            [sifra]
        );

        if (existingLager.rows.length > 0) {
            // Ažuriraj postojeći zapis u lageru
            await db.query(
                'UPDATE lager SET naziv = $1, "JM" = $2, "cena_bez_PDV" = $3, "cena_sa_PDV" = $4, updated_at = CURRENT_TIMESTAMP WHERE sifra = $5',
                [naziv.trim(), jm.trim(), cenaBezPDV, priceValue, sifra]
            );
        } else {
            // Kreiraj novi zapis u lageru - SA automatskim izračunavanjem cene bez PDV-a
            await db.query(
                `INSERT INTO lager (sifra, naziv, "JM", kolicina, "cena_bez_PDV", "cena_sa_PDV", updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
                [sifra, naziv.trim(), jm.trim(), 0, cenaBezPDV, priceValue]
            );
        }

        await db.query('COMMIT');

        res.status(201).json({
            message: "Artikal je uspešno kreiran i sinhronizovan sa lagerom.",
            article: result.rows[0],
            cenaBezPDV: cenaBezPDV.toFixed(2),
            cenaSaPDV: priceValue.toFixed(2)
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error creating article:", error);
        res.status(500).json({ error: "Greška pri kreiranju artikla." });
    }
});

app.put("/artikli/:sifra", async (req, res) => {
    try {
        const { sifra } = req.params;
        const { naziv, jm, cena, vrsta } = req.body;

        if (!naziv || !jm || !vrsta) {
            return res.status(400).json({
                error: "Sva obavezna polja moraju biti popunjena."
            });
        }

        const existingArticle = await db.query(
            'SELECT * FROM "artikli" WHERE "sifra" = $1',
            [sifra]
        );

        if (existingArticle.rows.length === 0) {
            return res.status(404).json({
                error: "Artikal nije pronađen."
            });
        }

        const priceValue = cena !== undefined ? parseFloat(cena) : (existingArticle.rows[0].cena || 0);
        if (isNaN(priceValue) || priceValue < 0) {
            return res.status(400).json({
                error: "Cena mora biti validni pozitivni broj."
            });
        }

        await db.query('BEGIN');

        const result = await db.query(
            'UPDATE "artikli" SET "naziv" = $1, "jm" = $2, "cena" = $3, "vrsta" = $4 WHERE "sifra" = $5 RETURNING *',
            [naziv.trim(), jm.trim(), priceValue, vrsta.trim(), sifra]
        );

        // Izračunaj cenu bez PDV-a (cena_sa_PDV / 1.21)
        const cenaBezPDV = priceValue / 1.21;

        // Sinhronizuj sa lager tabelom - SA automatskim izračunavanjem cene bez PDV-a
        const existingLager = await db.query(
            'SELECT sifra FROM lager WHERE sifra = $1',
            [sifra]
        );

        if (existingLager.rows.length > 0) {
            // Ažuriraj postojeći zapis u lageru
            await db.query(
                'UPDATE lager SET naziv = $1, "JM" = $2, "cena_bez_PDV" = $3, "cena_sa_PDV" = $4, updated_at = CURRENT_TIMESTAMP WHERE sifra = $5',
                [naziv.trim(), jm.trim(), cenaBezPDV, priceValue, sifra]
            );
        } else {
            // Kreiraj novi zapis u lageru - SA automatskim izračunavanjem cene bez PDV-a
            await db.query(
                `INSERT INTO lager (sifra, naziv, "JM", kolicina, "cena_bez_PDV", "cena_sa_PDV", updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
                [sifra, naziv.trim(), jm.trim(), 0, cenaBezPDV, priceValue]
            );
        }

        await db.query('COMMIT');

        res.json({
            message: "Artikal je uspešno ažuriran i sinhronizovan sa lagerom.",
            article: result.rows[0],
            cenaBezPDV: cenaBezPDV.toFixed(2),
            cenaSaPDV: priceValue.toFixed(2)
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error updating article:", error);
        res.status(500).json({ error: "Greška pri ažuriranju artikla." });
    }
});


// Delete article
app.delete("/artikli/:sifra", async (req, res) => {
    try {
        const { sifra } = req.params;

        const existingArticle = await db.query(
            'SELECT * FROM "artikli" WHERE "sifra" = $1',
            [sifra]
        );

        if (existingArticle.rows.length === 0) {
            return res.status(404).json({
                error: "Artikal nije pronađen."
            });
        }

        await db.query('DELETE FROM "artikli" WHERE "sifra" = $1', [sifra]);

        res.json({
            message: "Artikal je uspešno obrisan."
        });

    } catch (error) {
        console.error("Error deleting article:", error);
        res.status(500).json({ error: "Greška pri brisanju artikla." });
    }
});

// Search articles
app.get("/api/artikli/search", async (req, res) => {
    try {
        const { q, priceMin, priceMax, vrsta } = req.query;

        let query = 'SELECT * FROM "artikli" WHERE 1=1';
        let params = [];
        let paramCount = 0;

        if (q) {
            paramCount++;
            query += ` AND (LOWER("sifra") LIKE $${paramCount} OR LOWER("naziv") LIKE $${paramCount})`;
            params.push(`%${q.toLowerCase()}%`);
        }

        if (priceMin) {
            paramCount++;
            query += ` AND "cena" >= $${paramCount}`;
            params.push(parseFloat(priceMin));
        }

        if (priceMax) {
            paramCount++;
            query += ` AND "cena" <= $${paramCount}`;
            params.push(parseFloat(priceMax));
        }

        if (vrsta) {
            paramCount++;
            query += ` AND LOWER("vrsta") LIKE $${paramCount}`;
            params.push(`%${vrsta.toLowerCase()}%`);
        }

        query += ' ORDER BY "sifra"';

        const result = await db.query(query, params);

        res.json(result.rows);

    } catch (error) {
        console.error("Error searching articles:", error);
        res.status(500).json({ error: "Greška pri pretrazi artikala." });
    }
});

// Bulk delete articles
app.delete("/api/artikli/bulk", async (req, res) => {
    try {
        const { sifre } = req.body;

        if (!sifre || !Array.isArray(sifre) || sifre.length === 0) {
            return res.status(400).json({
                error: "Lista šifara je obavezna."
            });
        }

        const placeholders = sifre.map((_, index) => `$${index + 1}`).join(',');

        const result = await db.query(
            `DELETE FROM "artikli" WHERE "sifra" IN (${placeholders})`,
            sifre
        );

        res.json({
            message: `Uspešno obrisano ${result.rowCount} artikala.`,
            deletedCount: result.rowCount
        });

    } catch (error) {
        console.error("Error bulk deleting articles:", error);
        res.status(500).json({ error: "Greška pri brisanju artikala." });
    }
});
// Middleware za automatsku sinhronizaciju cena artikala
app.use('/artikli', async (req, res, next) => {
    if (req.method === 'GET' && !req.path.includes('/api/artikli/sync-prices')) {
        try {
            // Pozovi automatsku sinhronizaciju u pozadini
            fetch(`http://localhost:${port}/api/artikli/sync-prices-auto`)
                .then(response => response.json())
                .then(data => {
                    console.log('Background auto-sync:', data.message);
                })
                .catch(err => {
                    console.log('Background auto-sync failed:', err.message);
                });
        } catch (error) {
            console.log('Background auto-sync error:', error.message);
        }
    }
    next();
});
// Efikasnija automatska sinhronizacija za pozadinsko izvršavanje
app.get("/api/artikli/background-sync", async (req, res) => {
    try {
        // Ova ruta se može pozvati iz cron job-a ili pozadinski
        const result = await db.query(`
            UPDATE artikli 
            SET cena = l."cena_sa_PDV"
            FROM lager l 
            WHERE artikli.sifra = l.sifra 
            AND (artikli.cena IS NULL OR artikli.cena != l."cena_sa_PDV")
        `);

        res.json({
            success: true,
            message: `Pozadinska sinhronizacija završena. Ažurirano: ${result.rowCount} artikala.`,
            updatedCount: result.rowCount
        });

    } catch (error) {
        console.error("Error in background sync:", error);
        res.status(500).json({ error: "Greška pri pozadinskoj sinhronizaciji." });
    }
});
// Export articles to CSV
app.get("/api/artikli/export/csv", async (req, res) => {
    try {
        const artikli = (await db.query(
            'SELECT "sifra", "naziv", "jm", "cena", "vrsta" FROM "artikli" ORDER BY "sifra"'
        )).rows;

        let csv = 'Šifra,Naziv,JM,Cena (EUR),Vrsta\n';

        artikli.forEach(artikal => {
            const row = [
                `"${artikal.sifra}"`,
                `"${artikal.naziv}"`,
                `"${artikal.jm}"`,
                artikal.cena || '0.00',
                `"${artikal.vrsta}"`
            ].join(',');
            csv += row + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="artikli.csv"');
        res.send('\ufeff' + csv);

    } catch (error) {
        console.error("Error exporting articles:", error);
        res.status(500).json({ error: "Greška pri eksportu artikala." });
    }
});

// Get articles statistics
app.get("/api/artikli/stats", async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_articles,
                COUNT(CASE WHEN "cena" > 0 THEN 1 END) as articles_with_price,
                AVG("cena") as average_price,
                MAX("cena") as max_price,
                MIN(CASE WHEN "cena" > 0 THEN "cena" END) as min_price,
                COUNT(DISTINCT "vrsta") as unique_categories,
                COUNT(DISTINCT "jm") as unique_units
            FROM "artikli"
        `);

        const categoryStats = await db.query(`
            SELECT "vrsta", COUNT(*) as count, AVG("cena") as avg_price
            FROM "artikli" 
            GROUP BY "vrsta" 
            ORDER BY count DESC
        `);

        res.json({
            general: stats.rows[0],
            categories: categoryStats.rows
        });

    } catch (error) {
        console.error("Error fetching articles statistics:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika." });
    }
});

app.get("/lager", async (req, res) => {
    try {
        const lagerArtikli = (await db.query(
            'SELECT * FROM lager ORDER BY sifra'
        )).rows;
        res.render("lager.ejs", { lagerArtikli });
    } catch (error) {
        console.error("Error fetching lager:", error);
        res.status(500).send("Greška pri dohvatanju lager podataka.");
    }
});

// API endpoint za lager (JSON response)
app.get("/api/lager", async(req, res) => {
    try {
        const lagerArtikli = (await db.query(
            'SELECT * FROM lager ORDER BY sifra'
        )).rows;
        
        console.log('API Lager response:', lagerArtikli.length, 'items found');
        res.json(lagerArtikli);
    } catch (error) {
        console.error("Error fetching lager:", error);
        res.status(500).json({ error: "Greška pri dohvatanju lager podataka." });
    }
});

// Uzmi pojedinačni lager artikal po ID-u
app.get("/lager/:id", async(req, res) => {
    const id = req.params.id;
    try {
        const result = await db.query('SELECT * FROM lager WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lager artikal nije pronađen' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching lager item:", error);
        res.status(500).json({ error: "Greška pri dohvatanju lager artikla." });
    }
});

// Uzmi lager artikal po šifri
app.get("/lager/sifra/:sifra", async(req, res) => {
    const sifra = req.params.sifra;
    try {
        const result = await db.query('SELECT * FROM lager WHERE sifra = $1', [sifra]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lager artikal nije pronađen' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching lager item by sifra:", error);
        res.status(500).json({ error: "Greška pri dohvatanju lager artikla." });
    }
});

app.post("/lager", async (req, res) => {
  try {
    console.log("POST /lager body:", req.body);

    const {
      sifra,
      naziv,
      jm,
      kolicina,
      cena_bez_PDV,
      cena_sa_PDV,
      cena_bez_pdv,
      cena_sa_pdv
    } = req.body;

    // ✅ Validacija osnovnih polja
    if (!sifra || !naziv || !jm) {
      return res.status(400).json({ error: "Šifra, naziv i jedinica mere su obavezni." });
    }

    // ✅ Uzimamo ispravne vrednosti cene (bilo velika ili mala slova)
    const cenaBezPDV = parseFloat(cena_bez_PDV ?? cena_bez_pdv);
    const cenaSaPDV = parseFloat(cena_sa_PDV ?? cena_sa_pdv);

    if (isNaN(cenaBezPDV) || isNaN(cenaSaPDV)) {
      return res.status(400).json({ error: "Cene moraju biti validni brojevi." });
    }

    const kolicinaVal = parseFloat(kolicina) || 0;

    // ✅ Proveri da li već postoji artikal
    const existing = await db.query('SELECT * FROM lager WHERE sifra = $1', [sifra]);

    if (existing.rows.length > 0) {
      // Ako postoji — ažuriraj
      await db.query(
        `UPDATE lager
         SET naziv = $1,
             "JM" = $2,
             "cena_bez_PDV" = $3,
             "cena_sa_PDV" = $4,
             "kolicina" = $5,
             updated_at = NOW()
         WHERE sifra = $6`,
        [naziv, jm, cenaBezPDV, cenaSaPDV, kolicinaVal, sifra]
      );
      return res.json({ message: "Artikal uspešno ažuriran u lageru." });
    } else {
      // Ako ne postoji — ubaci novi
      await db.query(
        `INSERT INTO lager (sifra, naziv, "JM", "cena_bez_PDV", "cena_sa_PDV", "kolicina")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sifra, naziv, jm, cenaBezPDV, cenaSaPDV, kolicinaVal]
      );
      return res.status(201).json({ message: "Artikal uspešno dodat u lager." });
    }
  } catch (error) {
    console.error("Greška u POST /lager:", error);
    res.status(500).json({ error: "Greška pri radu sa lagerom: " + error.message });
  }
});


app.put("/lager/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      naziv,
      jm,
      kolicina,
      cena_bez_PDV,
      cena_sa_PDV,
      cena_bez_pdv,
      cena_sa_pdv
    } = req.body;

    console.log(`PUT /lager/${id} body:`, req.body);

    if (!naziv || !jm) {
      return res.status(400).json({ error: "Naziv i jedinica mere su obavezni." });
    }

    const cenaBezPDV = parseFloat(cena_bez_PDV ?? cena_bez_pdv);
    const cenaSaPDV = parseFloat(cena_sa_PDV ?? cena_sa_pdv);
    if (isNaN(cenaBezPDV) || isNaN(cenaSaPDV)) {
      return res.status(400).json({ error: "Cene moraju biti validni brojevi." });
    }

    const kolicinaVal = parseFloat(kolicina) || 0;

    // Proveri da li artikal postoji
    const existing = await db.query('SELECT * FROM lager WHERE sifra = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Artikal sa tom šifrom nije pronađen." });
    }

    // Ažuriraj
    await db.query(
      `UPDATE lager
       SET naziv = $1,
           "JM" = $2,
           "cena_bez_PDV" = $3,
           "cena_sa_PDV" = $4,
           "kolicina" = $5,
           updated_at = NOW()
       WHERE sifra = $6`,
      [naziv, jm, cenaBezPDV, cenaSaPDV, kolicinaVal, id]
    );

    res.json({ message: "Artikal uspešno ažuriran u lageru." });
  } catch (error) {
    console.error("Greška u PUT /lager/:id:", error);
    res.status(500).json({ error: "Greška pri ažuriranju artikla u lageru: " + error.message });
  }
});



// Obrisi artikal sa lagera po sifri
app.delete("/lager/:sifra", async (req, res) => {
  try {
    const { sifra } = req.params;

    // prvo proveri da li postoji
    const result = await db.query("SELECT * FROM lager WHERE sifra = $1", [sifra]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Artikal sa šifrom ${sifra} nije pronađen.` });
    }

    // obrisi po sifri
    await db.query("DELETE FROM lager WHERE sifra = $1", [sifra]);

    res.json({ message: `Artikal sa šifrom ${sifra} uspešno obrisan.` });
  } catch (error) {
    console.error("Greška u DELETE /lager/:sifra:", error);
    res.status(500).json({ error: "Greška pri brisanju artikla iz lagera." });
  }
});




app.patch("/lager/:id/quantity", async (req, res) => {
    const id = req.params.id;
    const { kolicina, operation } = req.body;
    
    try {
        if (kolicina === undefined) {
            return res.status(400).json({ error: "Količina je obavezna." });
        }

        // Uzmi trenutne podatke artikla
        const currentItem = await db.query('SELECT * FROM lager WHERE id = $1', [id]);
        if (currentItem.rows.length === 0) {
            return res.status(404).json({ error: "Lager artikal nije pronađen." });
        }

        const item = currentItem.rows[0];
        let newQuantity;

        switch(operation) {
            case 'add':
                newQuantity = parseFloat(item.kolicina) + parseFloat(kolicina);
                break;
            case 'subtract':
                newQuantity = parseFloat(item.kolicina) - parseFloat(kolicina);
                break;
            case 'set':
            default:
                newQuantity = parseFloat(kolicina);
                break;
        }

        // DOZVOLJAVAMO NEGATIVNE KOLIČINE - UKLONJENA PROVERA
        await db.query(
            'UPDATE lager SET kolicina = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newQuantity, id]
        );

        res.json({ 
            message: "Količina lager artikla je uspešno ažurirana.",
            newQuantity: newQuantity,
            oldQuantity: item.kolicina
        });
    } catch (error) {
        console.error("Error updating lager quantity:", error);
        res.status(500).json({ error: "Greška pri ažuriranju količine: " + error.message });
    }
});



// Pretraži lager po nazivu ili šifri
app.get("/api/lager/search", async (req, res) => {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
        return res.status(400).json({ error: "Upit mora imati najmanje 2 karaktera." });
    }

    try {
        const searchResult = await db.query(
            `SELECT * FROM lager 
             WHERE LOWER(naziv) LIKE LOWER($1) OR LOWER(sifra) LIKE LOWER($1)
             ORDER BY sifra`,
            [`%${query}%`]
        );

        res.json(searchResult.rows);
    } catch (error) {
        console.error("Error searching lager:", error);
        res.status(500).json({ error: "Greška pri pretraživanju lagera." });
    }
});

// Lager statistike
app.get("/api/lager/stats", async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_items,
                COUNT(CASE WHEN kolicina > 0 THEN 1 END) as items_in_stock,
                COUNT(CASE WHEN kolicina = 0 THEN 1 END) as out_of_stock,
                COUNT(CASE WHEN kolicina < 5 AND kolicina > 0 THEN 1 END) as low_stock,
                ROUND(AVG(cena_bez_PDV), 2) as avg_price_bez_PDV,
                ROUND(SUM(kolicina * cena_bez_PDV), 2) as total_value_bez_PDV,
                ROUND(SUM(kolicina * cena_sa_PDV), 2) as total_value_sa_PDV
            FROM lager
        `);

        res.json(stats.rows[0]);
    } catch (error) {
        console.error("Error fetching lager stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika lagera." });
    }
});

// =============================================================================
// KOMERCIJALISTI ROUTES - SA DINAMIČKIM PERFORMANSAMA IZ DOKUMENTI TABELE
// =============================================================================

app.get("/komercijalisti", async (req, res) => {
    try {
        // Učitaj osnovne podatke komercijalista (bez performansi - one se računaju u frontendu)
        const komercijalisti = (await db.query(
            'SELECT id, ime_prezime, status FROM komercijalisti ORDER BY ime_prezime'
        )).rows;
        
        console.log('Loaded komercijalisti for rendering:', komercijalisti.length);
        
        res.render("komercijalisti.ejs", { komercijalisti });
    } catch (error) {
        console.error("Error fetching komercijalisti:", error);
        res.status(500).send("Greška pri dohvatanju komercijalista.");
    }
});

// API endpoint za komercijaliste sa kompletnim podacima iz dokumenti tabele
app.get("/api/komercijalisti", async(req, res) => {
    try {
        const { datum_od, datum_do } = req.query;
        
        // Osnovni podaci komercijalista
        const komercijalisti = (await db.query(
            'SELECT id, ime_prezime, status FROM komercijalisti ORDER BY ime_prezime'
        )).rows;
        
        // Pripremi WHERE klauzulu za filtriranje po datumu
        let dateFilter = '';
        let queryParams = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND d.datum >= $${paramCount}`;
            queryParams.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND d.datum <= $${paramCount}`;
            queryParams.push(datum_do);
        }
        
        // Dobij statistike za svakog komercijalista iz dokumenti tabele
        const statsQuery = `
            SELECT 
                k.id,
                k.ime_prezime,
                k.status,
                COALESCE(COUNT(d.id), 0) as broj_dokumenata,
                COALESCE(SUM(d.iznos_sa_pdv), 0) as ukupan_promet,
                COALESCE(COUNT(DISTINCT d.partner), 0) as broj_kupaca,
                COALESCE(AVG(d.iznos_sa_pdv), 0) as prosecna_vrednost_dokumenta
            FROM komercijalisti k
            LEFT JOIN dokumenti d ON d.komercijalist_id = k.id${dateFilter}
            GROUP BY k.id, k.ime_prezime, k.status
            ORDER BY k.ime_prezime
        `;
        
        const komercijalistiStats = (await db.query(statsQuery, queryParams)).rows;
        
        console.log('API Komercijalisti response with stats:', komercijalistiStats.length, 'komercijalisti found');
        
        res.json(komercijalistiStats);
    } catch (error) {
        console.error("Error fetching komercijalisti with stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju komercijalista sa statistikama." });
    }
});

// Uzmi pojedinačnog komercijalista po ID-u sa statistikama
app.get("/komercijalisti/:id", async(req, res) => {
    const id = req.params.id;
    const { datum_od, datum_do } = req.query;
    
    try {
        // Osnovni podaci komercijalista
        const komercijalistResult = await db.query(
            'SELECT id, ime_prezime, status FROM komercijalisti WHERE id = $1', 
            [id]
        );
        
        if (komercijalistResult.rows.length === 0) {
            return res.status(404).json({ error: 'Komercijalist nije pronađen' });
        }
        
        const komercijalist = komercijalistResult.rows[0];
        
        // Pripremi WHERE klauzulu za filtriranje po datumu
        let dateFilter = '';
        let queryParams = [id];
        let paramCount = 1;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND datum >= $${paramCount}`;
            queryParams.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND datum <= $${paramCount}`;
            queryParams.push(datum_do);
        }
        
        // Dobij statistike iz dokumenti tabele
        const statsQuery = `
            SELECT 
                COUNT(*) as broj_dokumenata,
                COALESCE(SUM(iznos_sa_pdv), 0) as ukupan_promet,
                COUNT(DISTINCT partner) as broj_kupaca,
                COALESCE(AVG(iznos_sa_pdv), 0) as prosecna_vrednost_dokumenta
            FROM dokumenti 
            WHERE komercijalist_id = $1${dateFilter}
        `;
        
        const stats = (await db.query(statsQuery, queryParams)).rows[0];
        
        // Kombinuj osnovne podatke sa statistikama
        const result = {
            ...komercijalist,
            broj_dokumenata: parseInt(stats.broj_dokumenata) || 0,
            ukupan_promet: parseFloat(stats.ukupan_promet) || 0,
            broj_kupaca: parseInt(stats.broj_kupaca) || 0,
            prosecna_vrednost_dokumenta: parseFloat(stats.prosecna_vrednost_dokumenta) || 0
        };
        
        res.json(result);
    } catch (error) {
        console.error("Error fetching komercijalist with stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju komercijalista." });
    }
});

// Dodaj novog komercijalista (samo osnovni podaci)
app.post("/komercijalisti", async (req, res) => {
    const { ime_prezime, status } = req.body;
    
    try {
        // Validacija obaveznih polja
        if (!ime_prezime) {
            return res.status(400).json({ error: "Ime i prezime je obavezno." });
        }

        // Validacija statusa
        const validStatuses = ['aktivan', 'neaktivan', 'pauza'];
        const finalStatus = status || 'aktivan';
        if (!validStatuses.includes(finalStatus)) {
            return res.status(400).json({ error: "Status mora biti 'aktivan', 'neaktivan' ili 'pauza'." });
        }

        // Proveri da li komercijalist sa istim imenom već postoji
        const existingKomercijalist = await db.query(
            'SELECT id FROM komercijalisti WHERE LOWER(ime_prezime) = LOWER($1)', 
            [ime_prezime]
        );
        
        if (existingKomercijalist.rows.length > 0) {
            return res.status(400).json({ error: "Komercijalist sa tim imenom već postoji." });
        }

        const result = await db.query(
            `INSERT INTO komercijalisti (ime_prezime, status)
            VALUES ($1, $2) RETURNING id`,
            [ime_prezime, finalStatus]
        );

        console.log(`New komercijalist created with ID: ${result.rows[0].id}`);

        res.status(201).json({ 
            message: "Komercijalist je uspešno dodat.",
            id: result.rows[0].id,
            ime_prezime: ime_prezime,
            status: finalStatus
        });
    } catch (error) {
        console.error("Error adding komercijalist:", error);
        res.status(500).json({ error: "Greška pri dodavanju komercijalista: " + error.message });
    }
});

// Izmeni komercijalista (samo osnovni podaci)
app.put("/komercijalisti/:id", async (req, res) => {
    const id = req.params.id;
    const { ime_prezime, status } = req.body;
    
    try {
        console.log(`Updating komercijalist ${id} with data:`, { ime_prezime, status });

        // Validacija obaveznih polja
        if (!ime_prezime) {
            return res.status(400).json({ error: "Ime i prezime je obavezno." });
        }

        // Proveri da li komercijalist postoji
        const existingKomercijalist = await db.query('SELECT * FROM komercijalisti WHERE id = $1', [id]);
        if (existingKomercijalist.rows.length === 0) {
            return res.status(404).json({ error: "Komercijalist nije pronađen." });
        }

        const existing = existingKomercijalist.rows[0];

        // Validacija statusa
        const validStatuses = ['aktivan', 'neaktivan', 'pauza'];
        const finalStatus = status || existing.status || 'aktivan';
        if (!validStatuses.includes(finalStatus)) {
            return res.status(400).json({ error: "Status mora biti 'aktivan', 'neaktivan' ili 'pauza'." });
        }

        // Proveri da li komercijalist sa istim imenom već postoji (osim trenutnog)
        const duplicateCheck = await db.query(
            'SELECT id FROM komercijalisti WHERE LOWER(ime_prezime) = LOWER($1) AND id != $2', 
            [ime_prezime, id]
        );
        
        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({ error: "Komercijalist sa tim imenom već postoji." });
        }

        await db.query(
            `UPDATE komercijalisti SET 
                ime_prezime = $1,
                status = $2
             WHERE id = $3`,
            [ime_prezime, finalStatus, id]
        );

        console.log(`Komercijalist ${id} successfully updated`);
        
        res.json({ 
            message: "Komercijalist je uspešno ažuriran.",
            id: id,
            ime_prezime: ime_prezime,
            status: finalStatus
        });
    } catch (error) {
        console.error("Error updating komercijalist:", error);
        res.status(500).json({ error: "Greška pri izmeni komercijalista: " + error.message });
    }
});

// Obrisi komercijalista
app.delete("/komercijalisti/:id", async (req, res) => {
    const id = req.params.id;
    try {
        // Proveri da li komercijalist postoji
        const existingKomercijalist = await db.query('SELECT id, ime_prezime FROM komercijalisti WHERE id = $1', [id]);
        if (existingKomercijalist.rows.length === 0) {
            return res.status(404).json({ error: "Komercijalist nije pronađen." });
        }

        const komercijalistName = existingKomercijalist.rows[0].ime_prezime;

        // Proveri da li komercijalist ima povezane dokumente
        const documentsCheck = await db.query('SELECT COUNT(*) as count FROM dokumenti WHERE komercijalist_id = $1', [id]);
        const documentCount = parseInt(documentsCheck.rows[0].count);

        if (documentCount > 0) {
            return res.status(400).json({ 
                error: `Ne možete obrisati komercijalista "${komercijalistName}" jer ima ${documentCount} povezanih dokumenata.` 
            });
        }

        await db.query('DELETE FROM komercijalisti WHERE id = $1', [id]);
        
        console.log(`Deleted komercijalist ${id}: ${komercijalistName}`);
        
        res.json({ 
            message: `Komercijalist "${komercijalistName}" je uspešno obrisan.`,
            deleted_name: komercijalistName
        });
    } catch (error) {
        console.error("Error deleting komercijalist:", error);
        if (error.code === '23503') { // PostgreSQL foreign key violation
            res.status(400).json({ error: "Ne možete obrisati komercijalista koji se koristi u drugim dokumentima." });
        } else {
            res.status(500).json({ error: "Greška pri brisanju komercijalista." });
        }
    }
});

// Pretraži komercijaliste po imenu
app.get("/api/komercijalisti/search", async (req, res) => {
    const { query, datum_od, datum_do } = req.query;
    
    if (!query || query.length < 2) {
        return res.status(400).json({ error: "Upit mora imati najmanje 2 karaktera." });
    }

    try {
        // Pripremi WHERE klauzulu za filtriranje po datumu
        let dateFilter = '';
        let queryParams = [`%${query}%`];
        let paramCount = 1;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND d.datum >= $${paramCount}`;
            queryParams.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND d.datum <= $${paramCount}`;
            queryParams.push(datum_do);
        }

        const searchQuery = `
            SELECT 
                k.id,
                k.ime_prezime,
                k.status,
                COALESCE(COUNT(d.id), 0) as broj_dokumenata,
                COALESCE(SUM(d.iznos_sa_pdv), 0) as ukupan_promet,
                COALESCE(COUNT(DISTINCT d.partner), 0) as broj_kupaca
            FROM komercijalisti k
            LEFT JOIN dokumenti d ON d.komercijalist_id = k.id${dateFilter}
            WHERE LOWER(k.ime_prezime) LIKE LOWER($1)
            GROUP BY k.id, k.ime_prezime, k.status
            ORDER BY k.ime_prezime
        `;

        const searchResult = await db.query(searchQuery, queryParams);

        res.json(searchResult.rows);
    } catch (error) {
        console.error("Error searching komercijalisti:", error);
        res.status(500).json({ error: "Greška pri pretraživanju komercijalista." });
    }
});

// Komercijalisti statistike sa dinamičkim podacima
app.get("/api/komercijalisti/stats", async (req, res) => {
    try {
        const { datum_od, datum_do } = req.query;
        
        // Pripremi WHERE klauzulu za filtriranje po datumu
        let dateFilter = '';
        let queryParams = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND d.datum >= $${paramCount}`;
            queryParams.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND d.datum <= $${paramCount}`;
            queryParams.push(datum_do);
        }

        // Osnovne statistike
        const basicStats = await db.query(`
            SELECT 
                COUNT(*) as total_komercijalisti,
                COUNT(CASE WHEN status = 'aktivan' THEN 1 END) as aktivni,
                COUNT(CASE WHEN status = 'neaktivan' THEN 1 END) as neaktivni,
                COUNT(CASE WHEN status = 'pauza' THEN 1 END) as na_pauzi
            FROM komercijalisti
        `);

        // Statistike iz dokumenti tabele
        const documentStatsQuery = `
            SELECT 
                COUNT(d.*) as total_dokumenata,
                COALESCE(SUM(d.iznos_sa_pdv), 0) as total_promet,
                COUNT(DISTINCT d.partner) as unique_partners,
                COUNT(DISTINCT d.komercijalist_id) as active_komercijalisti_with_docs,
                COALESCE(AVG(d.iznos_sa_pdv), 0) as avg_document_value
            FROM dokumenti d
            WHERE 1=1${dateFilter}
        `;

        const documentStats = await db.query(documentStatsQuery, queryParams);

        // Top performeri na osnovu prometa
        const topPerformersQuery = `
            SELECT 
                k.ime_prezime,
                k.status,
                COUNT(d.id) as broj_dokumenata,
                COALESCE(SUM(d.iznos_sa_pdv), 0) as ukupan_promet,
                COUNT(DISTINCT d.partner) as broj_kupaca,
                COALESCE(AVG(d.iznos_sa_pdv), 0) as prosecna_vrednost
            FROM komercijalisti k
            LEFT JOIN dokumenti d ON d.komercijalist_id = k.id${dateFilter}
            WHERE k.status = 'aktivan'
            GROUP BY k.id, k.ime_prezime, k.status
            ORDER BY ukupan_promet DESC, broj_dokumenata DESC
            LIMIT 5
        `;

        const topPerformers = await db.query(topPerformersQuery, queryParams);

        // Kombinuj rezultate
        const result = {
            ...basicStats.rows[0],
            ...documentStats.rows[0],
            top_performers: topPerformers.rows,
            date_range: {
                datum_od: datum_od || null,
                datum_do: datum_do || null
            }
        };

        res.json(result);
    } catch (error) {
        console.error("Error fetching komercijalisti stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika komercijalista." });
    }
});

// Ažuriraj status komercijalista
app.patch("/komercijalisti/:id/status", async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;
    
    try {
        // Validacija statusa
        const validStatuses = ['aktivan', 'neaktivan', 'pauza'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: "Status mora biti 'aktivan', 'neaktivan' ili 'pauza'." });
        }

        // Proveri da li komercijalist postoji
        const existingKomercijalist = await db.query(
            'SELECT id, ime_prezime, status as current_status FROM komercijalisti WHERE id = $1', 
            [id]
        );
        
        if (existingKomercijalist.rows.length === 0) {
            return res.status(404).json({ error: "Komercijalist nije pronađen." });
        }

        const komercijalist = existingKomercijalist.rows[0];

        // Ažuriraj samo status
        await db.query('UPDATE komercijalisti SET status = $1 WHERE id = $2', [status, id]);
        
        console.log(`Successfully updated status for komercijalist ${id} (${komercijalist.ime_prezime}) from ${komercijalist.current_status} to ${status}`);
        
        res.json({ 
            message: `Status komercijalista "${komercijalist.ime_prezime}" je uspešno ažuriran sa "${komercijalist.current_status}" na "${status}".`,
            id: id,
            ime_prezime: komercijalist.ime_prezime,
            old_status: komercijalist.current_status,
            new_status: status
        });
    } catch (error) {
        console.error("Error updating komercijalist status:", error);
        res.status(500).json({ error: "Greška pri ažuriranju statusa komercijalista: " + error.message });
    }
});

// Detaljni pregled komercijalista sa svim dokumentima
app.get("/komercijalisti/:id/dokumenti", async (req, res) => {
    const id = req.params.id;
    const { datum_od, datum_do, limit = 50 } = req.query;
    
    try {
        // Proveri da li komercijalist postoji
        const komercijalistResult = await db.query(
            'SELECT id, ime_prezime, status FROM komercijalisti WHERE id = $1', 
            [id]
        );
        
        if (komercijalistResult.rows.length === 0) {
            return res.status(404).json({ error: 'Komercijalist nije pronađen' });
        }

        const komercijalist = komercijalistResult.rows[0];

        // Pripremi WHERE klauzulu za filtriranje po datumu
        let dateFilter = '';
        let queryParams = [id];
        let paramCount = 1;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND datum >= $${paramCount}`;
            queryParams.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND datum <= $${paramCount}`;
            queryParams.push(datum_do);
        }

        // Dodaj limit
        paramCount++;
        queryParams.push(parseInt(limit));

        // Dobij sve dokumente komercijalista
        const documentsQuery = `
            SELECT 
                id,
                datum,
                partner,
                tip_dokumenta,
                naziv_artikla,
                kolicina,
                iznos_bez_pdv,
                iznos_sa_pdv,
                pdv_iznos,
                rabat
            FROM dokumenti 
            WHERE komercijalist_id = $1${dateFilter}
            ORDER BY datum DESC, id DESC
            LIMIT $${paramCount}
        `;

        const documents = await db.query(documentsQuery, queryParams);

        res.json({
            komercijalist: komercijalist,
            dokumenti: documents.rows,
            total_count: documents.rows.length,
            filters: {
                datum_od: datum_od || null,
                datum_do: datum_do || null,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error("Error fetching komercijalist documents:", error);
        res.status(500).json({ error: "Greška pri dohvatanju dokumenata komercijalista." });
    }
});


// =============================================================================
// NOVA SEKCIJA: PRAVLJENJE DOKUMENATA - UNIFIED DOCUMENT CREATION
// =============================================================================

// GET - Pravljenje dokumenata stranica
app.get("/pravljenjedokumenta", async (req, res) => {
    try {
        const [dokumenti, lagerArtikli, komercijalisti, partneri] = await Promise.all([
            db.query('SELECT * FROM dokumenti ORDER BY id DESC'),
            db.query('SELECT * FROM lager ORDER BY sifra'),
            db.query('SELECT * FROM komercijalisti ORDER BY ime_prezime'),
            db.query('SELECT * FROM partneri ORDER BY "Naziv_partnera"')
        ]);

        const rows = dokumenti.rows;

        // Izračunaj sume
        const ukupnoBezPdv = rows.reduce((sum, d) => sum + (parseFloat(d.iznos_bez_pdv) || 0), 0);
        const ukupnoPdv    = rows.reduce((sum, d) => sum + (parseFloat(d.pdv_iznos) || 0), 0);
        const ukupnoSaPdv  = rows.reduce((sum, d) => sum + (parseFloat(d.iznos_sa_pdv) || 0), 0);

        res.render("pravljenjedokumenta.ejs", { 
            dokumenti: rows,
            lagerArtikli: lagerArtikli.rows,
            komercijalisti: komercijalisti.rows,
            partneri: partneri.rows,
            ukupnoBezPdv,
            ukupnoPdv,
            ukupnoSaPdv
        });
    } catch (error) {
        console.error("Error fetching data for pravljenjedokumenta:", error);
        res.status(500).send("Greška pri dohvatanju podataka za pravljenje dokumenata.");
    }
});

// POST - Kreiranje dokumenta sa šifrom magacina - ISPRAVLJENA VERZIJA
app.post("/api/pravljenjedokumenta", async (req, res) => {
    try {
        await db.query('BEGIN');
        
        const { 
            tipDokumenta, 
            partner, 
            komercijalist_id,
            artikli, 
            rabat, 
            ukupanIznos,
            magacin // Ovo je šifra magacina (npr. "VEL001")
        } = req.body;
        
        // Validacija
        if (!tipDokumenta || !partner || !komercijalist_id || !artikli || artikli.length === 0 || !magacin) {
            await db.query('ROLLBACK');
            return res.status(400).json({ 
                error: "Tip dokumenta, partner, komercijalist, artikli i magacin su obavezni." 
            });
        }

        // Validacija komercijalista
        const komercijalistResult = await db.query(
            'SELECT * FROM komercijalisti WHERE id = $1 AND status = \'aktivan\'', 
            [komercijalist_id]
        );
        if (komercijalistResult.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: "Komercijalist nije pronađen ili nije aktivan." });
        }
        const komercijalist = komercijalistResult.rows[0];

        const today = new Date().toISOString().split('T')[0];
        
        // GENERIŠI NOVU ŠIFRU DOKUMENTA SA ŠIFROM MAGACINA
        const documentTypeMap = {
            'ponuda': 'ponuda',
            'predracun': 'predracun', 
            'otpremnica': 'otpremnica',
            'kalkulacija': 'kalkulacija'
        };
        
        const docType = documentTypeMap[tipDokumenta] || 'dokument';
        
        // Pronađi poslednji broj za ovaj tip dokumenta
        const lastDoc = await db.query(
            `SELECT tip_dokumenta 
             FROM dokumenti 
             WHERE LOWER(tip_dokumenta) LIKE LOWER($1 || '%')
             ORDER BY id DESC 
             LIMIT 1`,
            [docType]
        );

        let nextNumber = 1;
        if (lastDoc.rows.length > 0) {
            const lastDocNumber = lastDoc.rows[0].tip_dokumenta;
            
            // Proveri da li dokument već ima šifru magacina
            if (lastDocNumber.includes('-')) {
                // Ako ima, uzmi samo deo pre '-' za određivanje broja
                const basePart = lastDocNumber.split('-')[0];
                const match = basePart.match(/(\d+)$/);
                if (match) {
                    nextNumber = parseInt(match[1]) + 1;
                }
            } else {
                // Stari format bez magacina
                const match = lastDocNumber.match(/(\d+)$/);
                if (match) {
                    nextNumber = parseInt(match[1]) + 1;
                }
            }
        }

        // Generiši osnovnu šifru (npr. "otpremnica9")
        const baseDocumentNumber = `${docType}${nextNumber}`;
        
        // Kreiraj kompletnu šifru sa magacinom (npr. "otpremnica9-VEL001")
        const fullDocumentNumber = `${baseDocumentNumber}-${magacin}`;
        
        // Obradi artikle
        const processedArtikli = [];
        let totalKolicina = 0;
        let lagerUpdateErrors = [];

        for (const artikal of artikli) {
            const lagerResult = await db.query(
                'SELECT sifra, naziv, "JM", kolicina, "cena_bez_PDV", "cena_sa_PDV" FROM lager WHERE sifra = $1',
                [artikal.sifra]
            );
            
            if (lagerResult.rows.length === 0) {
                lagerUpdateErrors.push(`Artikal ${artikal.sifra} nije pronađen u lageru`);
                continue;
            }
            
            const lagerArtikal = lagerResult.rows[0];
            const requestedQuantity = parseFloat(artikal.kolicina) || 0;
            
            // Za otpremnicu i kalkulaciju, oduzmi sa lagera
            if (['otpremnica', 'kalkulacija'].includes(tipDokumenta.toLowerCase())) {
                await db.query(
                    'UPDATE lager SET kolicina = kolicina - $1 WHERE sifra = $2',
                    [requestedQuantity, artikal.sifra]
                );
            }
            
            // Čuvaj ORIGINALNE cene iz lagera
            processedArtikli.push({
                sifra: artikal.sifra,
                naziv: lagerArtikal.naziv,
                jm: lagerArtikal.JM || 'kom',
                kolicina: requestedQuantity,
                cena_bez_pdv: parseFloat(lagerArtikal.cena_bez_PDV) || 0,
                cena_sa_pdv: parseFloat(lagerArtikal.cena_sa_PDV) || 0,
                rabat: parseFloat(artikal.rabat) || 0
            });
            
            totalKolicina += requestedQuantity;
        }

        if (lagerUpdateErrors.length > 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ 
                error: "Greške pri obradi lagera",
                details: lagerUpdateErrors 
            });
        }

        if (processedArtikli.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: "Nijedan artikal nije uspešno obrađen." });
        }
        
        // String artikala
        const artikliString = processedArtikli.map(item => 
            `${item.sifra} - ${item.naziv} (${item.kolicina} ${item.jm})`
        ).join(', ');
        
        // KALKULACIJA - Čuva originalnu cenu, računa sa rabatom
        let totalBezPdvBEZRabata = 0;
        let totalBezPdvSARabatom = 0;
        let totalPdv = 0;
        let totalSaPdv = 0;
        let sumaRabata = 0;

        processedArtikli.forEach(artikal => {
            const kolicina = parseFloat(artikal.kolicina) || 0;
            const cenaBezPdv = parseFloat(artikal.cena_bez_pdv) || 0;
            const cenaSaPdv = parseFloat(artikal.cena_sa_pdv) || 0;
            const rabat = parseFloat(artikal.rabat) || 0;
            
            const iznosBezPdvOriginal = cenaBezPdv * kolicina;
            const rabatIznos = iznosBezPdvOriginal * (rabat / 100);
            const iznosBezPdvSaRabatom = iznosBezPdvOriginal - rabatIznos;
            const pdvIznos = iznosBezPdvSaRabatom * 0.21;
            const iznosSaPdv = iznosBezPdvSaRabatom + pdvIznos;
            
            totalBezPdvBEZRabata += iznosBezPdvOriginal;
            totalBezPdvSARabatom += iznosBezPdvSaRabatom;
            totalPdv += pdvIznos;
            totalSaPdv += iznosSaPdv;
            sumaRabata += rabat;
        });

        // Prosečan rabat
        const prosecniRabat = processedArtikli.length > 0 
            ? sumaRabata / processedArtikli.length 
            : 0;
        
        // Nađi naziv partnera
        const partnerRes = await db.query(
            'SELECT "Naziv_partnera" FROM partneri WHERE "Sifra" = $1',
            [partner]
        );

        if (partnerRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: "Partner nije pronađen." });
        }

        const partnerNaziv = partnerRes.rows[0].Naziv_partnera;

        // Upiši u bazu
        const documentResult = await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, magacin, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat, komercijalist_id
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
                today,
                partnerNaziv,
                fullDocumentNumber, // Koristite kompletnu šifru
                magacin, // Ovo je šifra magacina
                artikliString,
                totalKolicina,
                parseFloat(totalBezPdvBEZRabata) || 0,
                parseFloat(totalSaPdv) || 0,
                parseFloat(totalPdv) || 0,
                prosecniRabat,
                komercijalist_id
            ]
        );

        const documentId = documentResult.rows[0].id;
        
        await db.query('COMMIT');

        console.log(`Document created: ${fullDocumentNumber}, Partner: ${partnerNaziv}, Magacin: ${magacin}`);
        
        res.json({ 
            success: true, 
            documentNumber: baseDocumentNumber,
            fullDocumentNumber: fullDocumentNumber,
            documentId: documentId,
            message: `${tipDokumenta} je uspešno kreiran/a`,
            komercijalist: komercijalist.ime_prezime,
            processedItems: processedArtikli.length,
            lagerUpdated: ['otpremnica', 'kalkulacija'].includes(tipDokumenta.toLowerCase())
        });
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error creating document:", error);
        res.status(500).json({ error: "Greška pri kreiranju dokumenta: " + error.message });
    } 
});
// GET - API za dokumente sa magacinom
app.get("/api/pravljenjedokumenta/dokumenti", async (req, res) => {
    try {
        const { 
            tip_dokumenta, 
            partner, 
            komercijalist,
            magacin, // Dodajte magacin filter
            datum_od, 
            datum_do,
            limit = 50 
        } = req.query;
        
        let query = `
            SELECT d.*, k.ime_prezime as komercijalist_ime 
            FROM dokumenti d
            LEFT JOIN komercijalisti k ON d.komercijalist_id = k.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;
        
        if (tip_dokumenta) {
            paramCount++;
            query += ` AND d.tip_dokumenta LIKE $${paramCount}`;
            params.push(`${tip_dokumenta}%`);
        }
        
        if (partner) {
            paramCount++;
            query += ` AND d.partner ILIKE $${paramCount}`;
            params.push(`%${partner}%`);
        }
        
        if (komercijalist) {
            paramCount++;
            query += ` AND k.ime_prezime ILIKE $${paramCount}`;
            params.push(`%${komercijalist}%`);
        }
        
        if (magacin) {
            paramCount++;
            query += ` AND d.magacin = $${paramCount}`;
            params.push(magacin);
        }
        
        if (datum_od) {
            paramCount++;
            query += ` AND d.datum >= $${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND d.datum <= $${paramCount}`;
            params.push(datum_do);
        }
        
        paramCount++;
        query += ` ORDER BY d.datum DESC, d.id DESC LIMIT $${paramCount}`;
        params.push(parseInt(limit));
        
        const dokumenti = (await db.query(query, params)).rows;
        res.json(dokumenti);
    } catch (error) {
        console.error("Error fetching filtered documents:", error);
        res.status(500).json({ error: "Greška pri dohvatanju dokumenata." });
    }
});

// API endpoint za dobijanje statistika dokumenata
app.get("/api/pravljenjedokumenta/stats", async (req, res) => {
    try {
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
        
        const startDate = `${currentMonth}-01`;               
        const endDate = new Date(currentMonth + "-01");
        endDate.setMonth(endDate.getMonth() + 1);            
        const endDateStr = endDate.toISOString().split("T")[0];

        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_documents,
                COUNT(CASE WHEN datum >= $1::date AND datum < $2::date THEN 1 END) as current_month_docs,
                COUNT(DISTINCT partner) as unique_partners,
                ROUND(SUM(iznos_sa_pdv), 2) as total_revenue,
                ROUND(AVG(iznos_sa_pdv), 2) as avg_document_value,
                COUNT(CASE WHEN tip_dokumenta LIKE 'Ponuda%' THEN 1 END) as ponude_count,
                COUNT(CASE WHEN tip_dokumenta LIKE 'Predračun%' THEN 1 END) as predracuni_count,
                COUNT(CASE WHEN tip_dokumenta LIKE 'Otpremnica%' THEN 1 END) as otpremnice_count,
                COUNT(CASE WHEN tip_dokumenta LIKE 'Kalkulacija%' THEN 1 END) as kalkulacije_count
            FROM dokumenti
        `, [startDate, endDateStr]);

        const topKomercijalisti = await db.query(`
            SELECT 
                k.ime_prezime,
                COUNT(d.id) as broj_dokumenata,
                ROUND(SUM(d.iznos_sa_pdv), 2) as ukupna_vrednost
            FROM komercijalisti k
            LEFT JOIN dokumenti d ON d.komercijalist_id = k.id
            WHERE k.status = 'aktivan'
            GROUP BY k.id, k.ime_prezime
            ORDER BY ukupna_vrednost DESC
            LIMIT 5
        `);

        res.json({
            ...stats.rows[0],
            top_komercijalisti: topKomercijalisti.rows,
            current_month: currentMonth
        });
    } catch (error) {
        console.error("Error fetching document stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika." });
    }
});
// GET - Dobij rabat za partnera i artikal
app.get("/api/rabat/:partnerSifra/:artikalSifra", async (req, res) => {
    try {
        const { partnerSifra, artikalSifra } = req.params;
        
        const result = await db.query(
            'SELECT rabat FROM partner_artikal_rabat WHERE partner_sifra = $1 AND artikal_sifra = $2',
            [partnerSifra, artikalSifra]
        );
        
        if (result.rows.length > 0) {
            res.json({ 
                success: true, 
                rabat: parseFloat(result.rows[0].rabat) 
            });
        } else {
            // Ako nema sačuvanog rabata, vrati 0
            res.json({ 
                success: true, 
                rabat: 0 
            });
        }
    } catch (error) {
        console.error("Error fetching rabat:", error);
        res.status(500).json({ error: "Greška pri dohvatanju rabata." });
    }
});

app.post("/api/rabat", async (req, res) => {
    try {
        const { partnerSifra, artikalSifra, rabat } = req.body;
        
        if (!partnerSifra || !artikalSifra) {
            return res.status(400).json({ 
                error: "Partner šifra i artikal šifra su obavezni." 
            });
        }
        
        const rabatValue = parseFloat(rabat) || 0;
        
        if (rabatValue < 0 || rabatValue > 100) {
            return res.status(400).json({ 
                error: "Rabat mora biti između 0 i 100." 
            });
        }
        
        // UPSERT (insert ili update ako već postoji)
        await db.query(`
            INSERT INTO partner_artikal_rabat (partner_sifra, artikal_sifra, rabat, poslednja_izmena)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (partner_sifra, artikal_sifra) 
            DO UPDATE SET rabat = $3, poslednja_izmena = CURRENT_TIMESTAMP
        `, [partnerSifra, artikalSifra, rabatValue]);
        
        res.json({ 
            success: true, 
            message: "Rabat je uspešno sačuvan.",
            rabat: rabatValue
        });
        
    } catch (error) {
        console.error("Error saving rabat:", error);
        res.status(500).json({ error: "Greška pri čuvanju rabata." });
    }
});

// API - Dobij sve rabate za partnera (POSTOJEĆA RUTA - BEZ IZMENA)
app.get("/api/rabat/partner/:partnerSifra", async (req, res) => {
    try {
        const { partnerSifra } = req.params;
        
        const result = await db.query(`
            SELECT 
                par.artikal_sifra,
                par.rabat,
                l.naziv,
                par.poslednja_izmena
            FROM partner_artikal_rabat par
            LEFT JOIN lager l ON l.sifra = par.artikal_sifra
            WHERE par.partner_sifra = $1
            ORDER BY par.poslednja_izmena DESC
        `, [partnerSifra]);
        
        res.json({ 
            success: true, 
            rabati: result.rows 
        });
        
    } catch (error) {
        console.error("Error fetching partner rabati:", error);
        res.status(500).json({ error: "Greška pri dohvatanju rabata partnera." });
    }
});
// GET - Uzmi dokument sa INDIVIDUALNIM RABATIMA po artiklima
app.get("/api/dokumenti/:id/artikli-sa-rabatima", async (req, res) => {
    try {
        const { id } = req.params;
        
        const dokumentResult = await db.query('SELECT * FROM dokumenti WHERE id = $1', [id]);
        if (dokumentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Dokument nije pronađen' });
        }
        
        const dokument = dokumentResult.rows[0];
        
        // Nađi partnera
        const partnerRes = await db.query(
            'SELECT "Sifra" FROM partneri WHERE "Naziv_partnera" = $1',
            [dokument.partner]
        );
        
        const partnerSifra = partnerRes.rows.length > 0 ? partnerRes.rows[0].Sifra : null;
        
        // Parsiraj artikle
        const artikli = parseArtikliFromDokument(dokument);
        
        // Dodaj INDIVIDUALNE rabate za svaki artikal
        for (let artikal of artikli) {
            if (partnerSifra && artikal.sifra !== 'N/A') {
                const rabatResult = await db.query(
                    'SELECT rabat FROM partner_artikal_rabat WHERE partner_sifra = $1 AND artikal_sifra = $2',
                    [partnerSifra, artikal.sifra]
                );
                
                artikal.rabat = rabatResult.rows.length > 0 ? parseFloat(rabatResult.rows[0].rabat) : 0;
            } else {
                artikal.rabat = 0;
            }
        }
        
        res.json({
            success: true,
            dokument: dokument,
            artikli: artikli
        });
        
    } catch (error) {
        console.error("Error fetching dokument artikli sa rabatima:", error);
        res.status(500).json({ error: "Greška pri dohvatanju dokumenta." });
    }
});
app.put("/api/partneri/:sifra/rabat", async (req, res) => {
    try {
        const { sifra } = req.params;
        const { rabat } = req.body;

        if (rabat < 0 || rabat > 100) {
            return res.status(400).json({ error: "Rabat mora biti između 0 i 100." });
        }

        const result = await db.query(
            'UPDATE partneri SET rabat = $1 WHERE "Sifra" = $2 RETURNING *',
            [rabat, sifra]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Partner nije pronađen." });
        }

        res.json({ success: true, partner: result.rows[0] });
    } catch (error) {
        console.error("Greška pri ažuriranju rabata:", error);
        res.status(500).json({ error: "Greška na serveru." });
    }
});


// =============================================================================
// PROMET ROBE ROUTES - POVEZANO SA DOKUMENTI TABELOM
// =============================================================================

// GET - Promet robe stranica
app.get('/prometrobe', async (req, res) => {
    try {
        res.render('prometrobe.ejs');
    } catch (err) {
        console.error('Error rendering promet robe page:', err);
        res.status(500).send('Server error');
    }
});

// Add this route to your backend
app.get("/api/magacini", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT magacin as sifra, magacin as naziv 
            FROM dokumenti 
            WHERE magacin IS NOT NULL AND magacin != '' 
            ORDER BY magacin
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching magacini:", error);
        res.status(500).json({ error: "Greška pri dohvatanju magacina." });
    }
});

// ISPRAVLJENA RUTA ZA PROMET ROBE
app.get('/api/prometrobe', async (req, res) => {
    try {
        const {
            datum_od,
            datum_do,
            partner,
            komercijalist,
            magacin
        } = req.query;

        let query = `
            SELECT 
                d.id,
                d.datum,
                d.partner,
                d.tip_dokumenta,
                d.naziv_artikla,
                d.kolicina,
                d.iznos_sa_pdv,
                d.iznos_bez_pdv,
                d.pdv_iznos,
                d.rabat,
                k.ime_prezime as komercijalist_ime,
                d.magacin,
                'kom' as jm  -- ISPRAVLJENO: koristite string umesto praznog aliasa
            FROM dokumenti d
            LEFT JOIN komercijalisti k ON d.komercijalist_id = k.id
            WHERE d.tip_dokumenta LIKE 'otpremnica%'
        `;
        
        const params = [];
        let paramCount = 0;

        // Date filters
        if (datum_od) {
            paramCount++;
            query += ` AND d.datum >= $${paramCount}`;
            params.push(datum_od);
        }

        if (datum_do) {
            paramCount++;
            query += ` AND d.datum <= $${paramCount}`;
            params.push(datum_do);
        }

        // Partner filter
        if (partner) {
            paramCount++;
            query += ` AND d.partner = $${paramCount}`;
            params.push(partner);
        }

        // Komercijalist filter
        if (komercijalist) {
            paramCount++;
            query += ` AND k.ime_prezime = $${paramCount}`;
            params.push(komercijalist);
        }

        // Magacin filter
        if (magacin) {
            paramCount++;
            query += ` AND d.magacin = $${paramCount}`;
            params.push(magacin);
        }

        query += ' ORDER BY d.datum DESC, d.id DESC';

        const result = await db.query(query, params);
        res.json(result.rows);
        
    } catch (err) {
        console.error('Error fetching promet robe data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});
// API - Get promet robe statistics (SAMO OTPREMNICE)
app.get('/api/prometrobe/stats', async (req, res) => {
    try {
        const { datum_od, datum_do } = req.query;
        
        let dateFilter = '';
        let params = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND datum >= $${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND datum <= $${paramCount}`;
            params.push(datum_do);
        }

        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT partner) as unique_partners,
                SUM(kolicina) as total_quantity,
                SUM(iznos_sa_pdv) as total_amount,
                AVG(iznos_sa_pdv) as avg_amount
            FROM dokumenti
            WHERE tip_dokumenta LIKE 'otpremnica%'${dateFilter}
        `, params);

        res.json(stats.rows[0]);
        
    } catch (err) {
        console.error('Error fetching promet robe stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API - Export promet robe to CSV (SAMO OTPREMNICE)
app.get('/api/prometrobe/export', async (req, res) => {
    try {
        const { datum_od, datum_do, partner } = req.query;
        
        let query = `
            SELECT 
                d.datum,
                d.partner,
                d.tip_dokumenta,
                d.naziv_artikla,
                d.kolicina,
                d.iznos_sa_pdv,
                k.ime_prezime as komercijalist
            FROM dokumenti d
            LEFT JOIN komercijalisti k ON d.komercijalist_id = k.id
            WHERE d.tip_dokumenta LIKE 'Otpremnica%'
        `;
        
        const params = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            query += ` AND d.datum >= $${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND d.datum <= $${paramCount}`;
            params.push(datum_do);
        }
        
        if (partner) {
            paramCount++;
            query += ` AND d.partner = $${paramCount}`;
            params.push(partner);
        }
        
        query += ' ORDER BY d.datum DESC';
        
        const result = await db.query(query, params);
        
        // Create CSV
        let csv = 'Datum,Partner,Broj otpremnice,Naziv artikla,Količina,Iznos sa PDV (€),Komercijalist\n';
        
        result.rows.forEach(row => {
            const line = [
                `"${row.datum}"`,
                `"${row.partner || ''}"`,
                `"${row.tip_dokumenta || ''}"`,
                `"${row.naziv_artikla || ''}"`,
                row.kolicina || '0',
                parseFloat(row.iznos_sa_pdv || 0).toFixed(2),
                `"${row.komercijalist || ''}"`
            ].join(',');
            csv += line + '\n';
        });

        const fileName = `otpremnice_${datum_od || 'all'}_${datum_do || 'all'}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send('\ufeff' + csv);
        
    } catch (err) {
        console.error('Error exporting promet robe:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API - Get promet by artikal (SAMO OTPREMNICE)
app.get('/api/prometrobe/by-artikal', async (req, res) => {
    try {
        const { datum_od, datum_do, limit = 50 } = req.query;
        
        let dateFilter = '';
        let params = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND datum >= $${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND datum <= $${paramCount}`;
            params.push(datum_do);
        }
        
        paramCount++;
        params.push(parseInt(limit));

        const result = await db.query(`
            SELECT 
                naziv_artikla,
                COUNT(*) as broj_otpremnica,
                SUM(kolicina) as ukupna_kolicina,
                SUM(iznos_sa_pdv) as ukupan_iznos,
                AVG(iznos_sa_pdv) as prosecna_vrednost
            FROM dokumenti
            WHERE tip_dokumenta LIKE 'otpremnica%' 
            AND naziv_artikla IS NOT NULL${dateFilter}
            GROUP BY naziv_artikla
            ORDER BY ukupan_iznos DESC
            LIMIT $${paramCount}
        `, params);

        res.json(result.rows);
        
    } catch (err) {
        console.error('Error fetching promet by artikal:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API - Get promet by partner (SAMO OTPREMNICE)
app.get('/api/prometrobe/by-partner', async (req, res) => {
    try {
        const { datum_od, datum_do, limit = 50 } = req.query;
        
        let dateFilter = '';
        let params = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND datum >= $${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND datum <= $${paramCount}`;
            params.push(datum_do);
        }
        
        paramCount++;
        params.push(parseInt(limit));

        const result = await db.query(`
            SELECT 
                partner,
                COUNT(*) as broj_otpremnica,
                SUM(kolicina) as ukupna_kolicina,
                SUM(iznos_sa_pdv) as ukupan_iznos,
                AVG(iznos_sa_pdv) as prosecna_vrednost,
                MAX(datum) as poslednja_otpremnica
            FROM dokumenti
            WHERE tip_dokumenta LIKE 'otpremnica%' 
            AND partner IS NOT NULL${dateFilter}
            GROUP BY partner
            ORDER BY ukupan_iznos DESC
            LIMIT $${paramCount}
        `, params);

        res.json(result.rows);
        
    } catch (err) {
        console.error('Error fetching promet by partner:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// GET - Prikaz svih dokumenata SA MOGUĆNOŠĆU IZMENE
app.get("/dokumenti", async (req, res) => {
    try {
        // Uzmi sve dokumente
        const dokumenti = (await db.query('SELECT * FROM dokumenti ORDER BY id DESC')).rows;
        
        // Uzmi jedinstvene partnere za filter
        const partneri = (await db.query('SELECT DISTINCT partner FROM dokumenti ORDER BY partner')).rows.map(row => row.partner);
        
        // PROMENA: Uzmi jedinstvene OSNOVNE tipove dokumenata za filter
        const tipoviRezultat = (await db.query('SELECT DISTINCT tip_dokumenta FROM dokumenti ORDER BY tip_dokumenta')).rows;
        
        // Ekstraktuj samo osnovne tipove (otpremnica, ponuda, predracun, kalkulacija)
        const osnovniTipovi = [];
        tipoviRezultat.forEach(row => {
            const tip = row.tip_dokumenta;
            // Izdvoji samo tekstualni deo pre bilo kojeg broja ili crtice
            const osnovniTip = tip.replace(/[\d-].*$/, '').trim();
            if (osnovniTip && !osnovniTipovi.includes(osnovniTip)) {
                osnovniTipovi.push(osnovniTip);
            }
        });
        
        // Uzmi jedinstvene nazive artikala za filter
        const artikli = (await db.query('SELECT DISTINCT naziv_artikla FROM dokumenti ORDER BY naziv_artikla')).rows.map(row => row.naziv_artikla);
        
        // Uzmi sve artikle iz lagera (za dodavanje novih artikala u dokument)
        const lagerArtikli = (await db.query('SELECT * FROM lager ORDER BY sifra')).rows;
        
        // Uzmi sve partnere (za izmenu dokumenta)
        const sviPartneri = (await db.query('SELECT * FROM partneri ORDER BY "Naziv_partnera"')).rows;
        
        // Uzmi sve komercijalist (za izmenu dokumenta)
        const komercijalisti = (await db.query('SELECT * FROM komercijalisti ORDER BY ime_prezime')).rows;
        
        // Uzmi jedinstvene magacine za filter
        const magacini = (await db.query('SELECT DISTINCT magacin FROM dokumenti WHERE magacin IS NOT NULL ORDER BY magacin')).rows.map(row => row.magacin);
        
        res.render("dokumenti.ejs", { 
            dokumenti, 
            partneri, 
            tipovi: osnovniTipovi,  // PROMENJENO: šaljemo osnovne tipove
            artikli,
            lagerArtikli,
            sviPartneri,
            komercijalisti,
            magacini
        });
    } catch (error) {
        console.error("Error fetching dokumenti:", error);
        res.status(500).send("Greška pri dohvatanju dokumenata.");
    }
});


// GET - Uzmi pojedinačni dokument sa parsiranim artiklima (JSON)
app.get("/api/dokumenti/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        const dokumentResult = await db.query('SELECT * FROM dokumenti WHERE id = $1', [id]);
        if (dokumentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Dokument nije pronađen' });
        }
        
        const dokument = dokumentResult.rows[0];
        
        // Parsiraj artikle iz polja naziv_artikla
        const artikli = parseArtikliFromDokument(dokument);
        
        res.json({
            success: true,
            dokument: dokument,
            artikli: artikli
        });
        
    } catch (error) {
        console.error("Error fetching dokument:", error);
        res.status(500).json({ error: "Greška pri dohvatanju dokumenta." });
    }
});

// PUT - Ažuriraj dokument sa artiklima
app.put("/api/dokumenti/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            datum,
            partner,
            tip_dokumenta,
            komercijalist_id,
            artikli, // Array artikala
            napomene
        } = req.body;
        
        // Validacija
        if (!datum || !partner || !tip_dokumenta || !artikli || artikli.length === 0) {
            return res.status(400).json({ 
                error: "Datum, partner, tip dokumenta i artikli su obavezni." 
            });
        }
        
        await db.query('BEGIN');
        
        // Kreiraj string artikala za čuvanje
        const artikliString = artikli.map(a => 
            `${a.sifra} - ${a.naziv} (${a.kolicina} ${a.jm})`
        ).join(', ');
        
        // Kalkulacije - ISPRAVLJENA LOGIKA
        let totalKolicina = 0;
        let totalBezPdv = 0;
        let totalSaPdv = 0;
        let totalPdv = 0;
        let totalRabat = 0;
        
        artikli.forEach(a => {
            const kol = parseFloat(a.kolicina) || 0;
            const cenaBezPdv = parseFloat(a.cena_bez_pdv) || 0;  // ORIGINALNA CENA
            const cenaSaPdv = parseFloat(a.cena_sa_pdv) || 0;    // ORIGINALNA CENA sa PDV
            const rabat = parseFloat(a.rabat) || 0;
            
            // Ukupno BEZ rabata
            const iznosBezPdvBefore = cenaBezPdv * kol;
            const iznosSaPdvBefore = cenaSaPdv * kol;
            
            // Rabat iznos
            const rabatAmount = iznosBezPdvBefore * (rabat / 100);
            const rabatAmountSaPdv = iznosSaPdvBefore * (rabat / 100);
            
            // Ukupno SA rabatom
            const iznosBezPdv = iznosBezPdvBefore - rabatAmount;
            const iznosSaPdv = iznosSaPdvBefore - rabatAmountSaPdv;
            
            const pdv = iznosSaPdv - iznosBezPdv;
            
            totalKolicina += kol;
            totalBezPdv += iznosBezPdv;
            totalSaPdv += iznosSaPdv;
            totalPdv += pdv;
            totalRabat += rabatAmount;
        });
        
        // Prosečan rabat
        const prosecniRabat = artikli.length > 0 
            ? artikli.reduce((sum, a) => sum + (parseFloat(a.rabat) || 0), 0) / artikli.length 
            : 0;
        
        // Ažuriraj dokument
        await db.query(`
            UPDATE dokumenti SET 
                datum = $1,
                partner = $2,
                tip_dokumenta = $3,
                naziv_artikla = $4,
                kolicina = $5,
                iznos_bez_pdv = $6,
                iznos_sa_pdv = $7,
                pdv_iznos = $8,
                rabat = $9,
                komercijalist_id = $10
            WHERE id = $11
        `, [
            datum,
            partner,
            tip_dokumenta,
            artikliString,
            totalKolicina,
            totalBezPdv,
            totalSaPdv,
            totalPdv,
            prosecniRabat,
            komercijalist_id || null,
            id
        ]);
        
        await db.query('COMMIT');
        
        console.log(`Document ${id} updated successfully with ${artikli.length} artikli`);
        
        res.json({ 
            success: true, 
            message: "Dokument je uspešno ažuriran.",
            documentId: id
        });
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error updating document:", error);
        res.status(500).json({ error: "Greška pri ažuriranju dokumenta: " + error.message });
    }
});

// Helper funkcija za parsiranje artikala iz dokumenta
function parseArtikliFromDokument(dokument) {
    const artikli = [];
    
    if (!dokument.naziv_artikla) return artikli;
    
    // Format: "šifra - naziv (količina jm), šifra2 - naziv2 (količina2 jm2)"
    const parts = dokument.naziv_artikla.split(', ');
    
    parts.forEach((part, index) => {
        const match = part.match(/^(.+?)\s-\s(.+?)\s\((.+?)\s(.+?)\)$/);
        if (match) {
            const [, sifra, naziv, kolicina, jm] = match;
            
            // Distribuj cene i rabat proporcionalno
            const kolicinaNum = parseFloat(kolicina) || 0;
            const totalKolicina = parseFloat(dokument.kolicina) || 1;
            
            artikli.push({
                rb: index + 1,
                sifra: sifra.trim(),
                naziv: naziv.trim(),
                jm: jm.trim(),
                kolicina: kolicinaNum,
                cena_bez_pdv: (parseFloat(dokument.iznos_bez_pdv) || 0) / totalKolicina,
                cena_sa_pdv: (parseFloat(dokument.iznos_sa_pdv) || 0) / totalKolicina,
                rabat: parseFloat(dokument.rabat) || 0
            });
        }
    });
    
    // Ako parsiranje ne uspe, kreiraj jedan red
    if (artikli.length === 0) {
        artikli.push({
            rb: 1,
            sifra: 'N/A',
            naziv: dokument.naziv_artikla,
            jm: 'kom',
            kolicina: parseFloat(dokument.kolicina) || 1,
            cena_bez_pdv: parseFloat(dokument.iznos_bez_pdv) || 0,
            cena_sa_pdv: parseFloat(dokument.iznos_sa_pdv) || 0,
            rabat: parseFloat(dokument.rabat) || 0
        });
    }
    
    return artikli;
}

// Uzmi pojedinačni dokument po ID-u
app.get("/dokumenti/:id", async (req, res) => {
    const id = req.params.id;
    try {
        const result = await db.query('SELECT * FROM dokumenti WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Dokument nije pronađen' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching dokument:", error);
        res.status(500).json({ error: "Greška pri dohvatanju dokumenta." });
    }
});

// DELETE - Obriši dokument sa potpunom obradom
app.delete("/dokumenti/:id", async (req, res) => {
    const id = req.params.id;
    try {
        // Proveri da li dokument postoji
        const dokumentResult = await db.query('SELECT * FROM dokumenti WHERE id = $1', [id]);
        if (dokumentResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Dokument nije pronađen." 
            });
        }

        const dokument = dokumentResult.rows[0];
        
        // Ako je dokument otpremnica ili kalkulacija, vrati količinu na lager
        if (dokument.tip_dokumenta.toLowerCase().includes('otpremnica') || 
            dokument.tip_dokumenta.toLowerCase().includes('kalkulacija')) {
            
            // Parsiraj artikle iz dokumenta
            const artikli = parseArtikliFromDokument(dokument);
            
            for (const artikal of artikli) {
                if (artikal.sifra && artikal.sifra !== 'N/A') {
                    // Vrati količinu na lager
                    await db.query(
                        'UPDATE lager SET kolicina = kolicina + $1 WHERE sifra = $2',
                        [artikal.kolicina, artikal.sifra]
                    );
                    console.log(`Vraćena količina ${artikal.kolicina} za artikal ${artikal.sifra} na lager`);
                }
            }
        }

        // Obriši dokument
        await db.query('DELETE FROM dokumenti WHERE id = $1', [id]);
        
        console.log(`Dokument obrisan: ID ${id}, Tip: ${dokument.tip_dokumenta}, Partner: ${dokument.partner}`);
        
        res.json({ 
            success: true, 
            message: "Dokument je uspešno obrisan." + 
                (dokument.tip_dokumenta.toLowerCase().includes('otpremnica') || 
                 dokument.tip_dokumenta.toLowerCase().includes('kalkulacija') ? 
                 " Količina je vraćena na lager." : "")
        });
        
    } catch (error) {
        console.error("Error deleting dokument:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri brisanju dokumenta: " + error.message 
        });
    }
});
// Dodaj dokument
app.post("/dokumenti", async (req, res) => {
    const d = req.body;
    try {
        const kolicina = parseFloat(d.kolicina) || 0;
        const iznos_bez_pdv = parseFloat(d.iznos_bez_pdv) || 0;
        const pdv_iznos = parseFloat(d.pdv_iznos) || 0;
        const rabat = parseFloat(d.rabat) || 0;
        const iznos_sa_pdv = parseFloat(d.iznos_sa_pdv) || 0;

        await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, magacin, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                d.datum,
                d.partner,
                d.tip_dokumenta,
                d.magacin,          // NOVO
                d.naziv_artikla,
                kolicina,
                iznos_bez_pdv,
                iznos_sa_pdv,
                pdv_iznos,
                rabat
            ]
        );

        res.sendStatus(201);
    } catch (error) {
        console.error("Error adding dokument:", error);
        res.status(500).send("Greška pri dodavanju dokumenta: " + error.message);
    }
});

// Izmeni dokument
app.put("/dokumenti/:id", async (req, res) => {
    const id = req.params.id;
    const d = req.body;
    try {
        const kolicina = parseFloat(d.kolicina) || 0;
        const iznos_bez_pdv = parseFloat(d.iznos_bez_pdv) || 0;
        const pdv_iznos = parseFloat(d.pdv_iznos) || 0;
        const rabat = parseFloat(d.rabat) || 0;
        const iznos_sa_pdv = parseFloat(d.iznos_sa_pdv) || 0;

        await db.query(
            `UPDATE dokumenti SET 
                datum = $1,
                partner = $2,
                tip_dokumenta = $3,
                naziv_artikla = $4,
                kolicina = $5,
                iznos_bez_pdv = $6,
                iznos_sa_pdv = $7,
                pdv_iznos = $8,
                rabat = $9
             WHERE id = $10`,
            [
                d.datum,
                d.partner,
                d.tip_dokumenta,
                d.naziv_artikla,
                kolicina,
                iznos_bez_pdv,
                iznos_sa_pdv,
                pdv_iznos,
                rabat,
                id
            ]
        );
        res.sendStatus(200);
    } catch (error) {
        console.error("Error updating dokument:", error);
        res.status(500).send("Greška pri izmeni dokumenta: " + error.message);
    }
});



// API endpoint za filtriranje dokumenata
app.get("/api/dokumenti/filter", async (req, res) => {
    try {
        const { partner, tip_dokumenta, naziv_artikla, datum_od, datum_do } = req.query;
        
        let query = 'SELECT * FROM dokumenti WHERE 1=1';
        const params = [];
        let paramCount = 0;
        
        if (partner) {
            paramCount++;
            query += ` AND partner = ${paramCount}`;
            params.push(partner);
        }
        
        if (tip_dokumenta) {
            paramCount++;
            query += ` AND tip_dokumenta = ${paramCount}`;
            params.push(tip_dokumenta);
        }
        
        if (naziv_artikla) {
            paramCount++;
            query += ` AND naziv_artikla = ${paramCount}`;
            params.push(naziv_artikla);
        }
        
        if (datum_od) {
            paramCount++;
            query += ` AND datum >= ${paramCount}::date`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND datum <= ${paramCount}::date`;
            params.push(datum_do);
        }
        
        query += ' ORDER BY datum DESC, id';
        
        const dokumenti = (await db.query(query, params)).rows;
        res.json(dokumenti);
    } catch (error) {
        console.error("Error filtering dokumenti:", error);
        res.status(500).json({ error: "Greška pri filtriranju dokumenata." });
    }
});

// API endpoint za generiranje broja dokumenata
app.get("/api/dokumenti/count", async (req, res) => {
    try {
        const { year, month, type } = req.query;
        let documentTypePattern;
        
        // Različiti paterni za različite tipove dokumenata
        switch(type) {
            case 'predracun':
                documentTypePattern = 'predračun%';
                break;
            case 'kalkulacija':
                documentTypePattern = 'kalkulacija%';
                break;
            case 'ponuda':
                documentTypePattern = 'ponuda%';
                break;
            case 'otpremnica':
            default:
                documentTypePattern = 'otpremnica%';
                break;
        }
        
        const startDate = `${year}-${month}-01`;
        const endDate = `${year}-${month}-31`;
        
        const result = await db.query(
            `SELECT COUNT(*) as count FROM dokumenti 
             WHERE tip_dokumenta LIKE $1 
             AND datum >= $2 AND datum <= $3`,
            [documentTypePattern, startDate, endDate]
        );
        
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        console.error("Error counting documents:", error);
        res.status(500).json({ error: "Greška pri brojanju dokumenata." });
    }
});
// API endpoint za pretragu artikala po nazivu (autocomplete)
app.get("/api/artikli/autocomplete", async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.length < 2) {
            return res.json([]);
        }
        
        // KLJUČNA PROMENA: Uzmi cene iz LAGER tabele, ne iz artikli
        const result = await db.query(
            `SELECT 
                l.sifra, 
                l.naziv, 
                l.jm as "JM", 
                l.cena_bez_PDV, 
                l.cena_sa_PDV 
             FROM lager l
             WHERE LOWER(l.naziv) LIKE LOWER($1) 
                OR CAST(l.sifra AS TEXT) LIKE $2
             ORDER BY l.naziv
             LIMIT 20`,
            [`%${query}%`, `%${query}%`]
        );
        
        const normalizedRows = result.rows.map(row => ({
            sifra: row.sifra,
            naziv: row.naziv,
            jm: row.JM || row.jm,
            cena_bez_pdv: parseFloat(row.cena_bez_PDV || row.cena_bez_pdv || 0),
            cena_sa_pdv: parseFloat(row.cena_sa_PDV || row.cena_sa_pdv || 0)
        }));
        
        console.log(`Autocomplete found ${normalizedRows.length} results for query: ${query}`);
        
        res.json(normalizedRows);
    } catch (error) {
        console.error("Error searching artikli:", error);
        res.status(500).json({ error: "Greška pri pretraživanju artikala." });
    }
});
// API route za automatsku sinhronizaciju cena iz lager tabele SA PDV kalkulacijom
app.get("/api/artikli/sync-prices-auto", async (req, res) => {
    try {
        await db.query('BEGIN');

        // Sinhronizuj cene iz lager tabele u artikli tabelu i ažuriraj cenu bez PDV-a
        const syncResult = await db.query(`
            UPDATE artikli 
            SET cena = l."cena_sa_PDV"
            FROM lager l 
            WHERE artikli.sifra = l.sifra 
            AND (artikli.cena IS NULL OR artikli.cena != l."cena_sa_PDV")
            RETURNING artikli.sifra, artikli.cena as stara_cena, l."cena_sa_PDV" as nova_cena
        `);

        // Takođe ažuriraj cenu bez PDV-a u lager tabeli za sve artikle
        const pdvUpdateResult = await db.query(`
            UPDATE lager 
            SET "cena_bez_PDV" = "cena_sa_PDV" / 1.21,
                updated_at = CURRENT_TIMESTAMP
            WHERE "cena_sa_PDV" IS NOT NULL
            RETURNING sifra, "cena_bez_PDV", "cena_sa_PDV"
        `);

        await db.query('COMMIT');

        res.json({
            success: true,
            message: `Automatski sinhronizovano ${syncResult.rowCount} cena artikala i ažurirane cene bez PDV-a za ${pdvUpdateResult.rowCount} artikala.`,
            updatedCount: syncResult.rowCount,
            pdvUpdatedCount: pdvUpdateResult.rowCount
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error in auto-sync prices:", error);
        res.status(500).json({ error: "Greška pri automatskoj sinhronizaciji cena." });
    }
});
// API endpoint za dobijanje artikla po šifri
app.get("/api/lager/sifra/:sifra", async (req, res) => {
    try {
        const { sifra } = req.params;
        
        const result = await db.query(
            'SELECT sifra, naziv, "JM", "cena_bez_PDV", "cena_sa_PDV" FROM lager WHERE sifra = $1',
            [sifra]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Artikal nije pronađen." });
        }
        
        // Normalizuj nazive kolona za frontend
        const row = result.rows[0];
        const normalizedData = {
            sifra: row.sifra,
            naziv: row.naziv,
            jm: row.JM,
            cena_bez_pdv: parseFloat(row.cena_bez_PDV || 0),
            cena_sa_pdv: parseFloat(row.cena_sa_PDV || 0)
        };
        
        res.json(normalizedData);
    } catch (error) {
        console.error("Error fetching artikal by sifra:", error);
        res.status(500).json({ error: "Greška pri dohvatanju artikla." });
    }
});
app.get("/magacini", (req, res) => {
    res.render("magacini.ejs");
});

// UPLATE ROUTES - SA POVEZIVANJEM SA PARTNERIMA I KOMERCIJALISTIMA

// GET - Uplate stranica sa podacima
app.get("/uplate", async(req, res) => {
    try {
        const uplate = (await db.query(
            'SELECT * FROM "uplate" ORDER BY "datum" DESC'
        )).rows;
        res.render("uplate.ejs", { uplate });
    } catch (error) {
        console.error("Error fetching uplate:", error);
        res.status(500).send("Greška pri dohvatanju uplata.");
    }
});

// GET - API endpoint za sve uplate (JSON response)
app.get("/api/uplate", async(req, res) => {
    try {
        const uplate = (await db.query(
            'SELECT * FROM "uplate" ORDER BY "datum" DESC'
        )).rows;
        res.json(uplate);
    } catch (error) {
        console.error("Error fetching uplate:", error);
        res.status(500).json({ error: "Greška pri dohvatanju uplata." });
    }
});

// GET - Uzmi pojedinačnu uplatu po ID-u
app.get("/api/uplate/:id", async(req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM "uplate" WHERE "id" = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Uplata nije pronađena." });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching uplata:", error);
        res.status(500).json({ error: "Greška pri dohvatanju uplate." });
    }
});

// POST - Dodaj novu uplatu (poboljšano sa validacijom partnera i komercijalista)
app.post("/api/uplate", async(req, res) => {
    try {
        const { 
            datum, 
            kupac, 
            iznos, 
            nacin, 
            status, 
            dokument, 
            komercijalist, 
            napomene,
            partner_sifra,
            komercijalist_id
        } = req.body;
        
        // Validacija osnovnih podataka
        if (!datum || !kupac || !iznos || !nacin) {
            return res.status(400).json({ 
                error: "Datum, kupac, iznos i način plaćanja su obavezni." 
            });
        }

        // Validacija iznosa
        const parsedIznos = parseFloat(iznos);
        if (isNaN(parsedIznos) || parsedIznos <= 0) {
            return res.status(400).json({ 
                error: "Iznos mora biti pozitivni broj." 
            });
        }

        // Validacija načina plaćanja
        const validNacini = ['gotovina', 'kartica', 'virman'];
        if (!validNacini.includes(nacin)) {
            return res.status(400).json({ 
                error: "Način plaćanja mora biti: gotovina, kartica ili virman." 
            });
        }

        // Validacija statusa
        const validStatusi = ['primljena', 'cekanje', 'odbijena'];
        const finalStatus = status || 'primljena';
        if (!validStatusi.includes(finalStatus)) {
            return res.status(400).json({ 
                error: "Status mora biti: primljena, cekanje ili odbijena." 
            });
        }

        // Opcionalna validacija partnera (ako je poslata šifra partnera)
        let validatedKupac = kupac;
        if (partner_sifra) {
            const partnerCheck = await db.query(
                'SELECT "Naziv_partnera" FROM "partneri" WHERE "Sifra" = $1',
                [partner_sifra]
            );
            
            if (partnerCheck.rows.length > 0) {
                validatedKupac = partnerCheck.rows[0].Naziv_partnera;
                console.log(`Partner validated: ${partner_sifra} -> ${validatedKupac}`);
            } else {
                console.log(`Partner not found for sifra: ${partner_sifra}, using manual entry: ${kupac}`);
            }
        }

        // Opcionalna validacija komercijalista (ako je poslat ID komercijalista)
        let validatedKomercijalist = komercijalist;
        if (komercijalist_id) {
            const komercijalistCheck = await db.query(
                'SELECT "ime_prezime" FROM "komercijalisti" WHERE "id" = $1 AND "status" = \'aktivan\'',
                [komercijalist_id]
            );
            
            if (komercijalistCheck.rows.length > 0) {
                validatedKomercijalist = komercijalistCheck.rows[0].ime_prezime;
                console.log(`Komercijalist validated: ${komercijalist_id} -> ${validatedKomercijalist}`);
            } else {
                console.log(`Komercijalist not found or inactive for ID: ${komercijalist_id}, using manual entry: ${komercijalist}`);
            }
        }
        
        const result = await db.query(`
            INSERT INTO "uplate" (datum, kupac, iznos, nacin, status, dokument, komercijalist, napomene) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
            RETURNING *
        `, [
            datum, 
            validatedKupac, 
            parsedIznos, 
            nacin, 
            finalStatus, 
            dokument || null, 
            validatedKomercijalist || null, 
            napomene || null
        ]);
        
        console.log(`New payment created: ID ${result.rows[0].id}, Customer: ${validatedKupac}, Amount: €${parsedIznos}`);
        
        res.status(201).json({
            message: "Uplata je uspešno dodana.",
            uplata: result.rows[0],
            validated: {
                partner_matched: partner_sifra && validatedKupac !== kupac,
                komercijalist_matched: komercijalist_id && validatedKomercijalist !== komercijalist
            }
        });
    } catch (error) {
        console.error("Error adding uplata:", error);
        res.status(500).json({ error: "Greška pri dodavanju uplate: " + error.message });
    }
});

// PUT - Ažuriraj uplatu (poboljšano sa validacijom partnera i komercijalista)
app.put("/api/uplate/:id", async(req, res) => {
    try {
        const { id } = req.params;
        const { 
            datum, 
            kupac, 
            iznos, 
            nacin, 
            status, 
            dokument, 
            komercijalist, 
            napomene,
            partner_sifra,
            komercijalist_id
        } = req.body;
        
        // Proveri da li uplata postoji
        const existingPayment = await db.query('SELECT * FROM "uplate" WHERE "id" = $1', [id]);
        if (existingPayment.rows.length === 0) {
            return res.status(404).json({ error: "Uplata nije pronađena." });
        }

        // Validacija osnovnih podataka
        if (!datum || !kupac || !iznos || !nacin) {
            return res.status(400).json({ 
                error: "Datum, kupac, iznos i način plaćanja su obavezni." 
            });
        }

        // Validacija iznosa
        const parsedIznos = parseFloat(iznos);
        if (isNaN(parsedIznos) || parsedIznos <= 0) {
            return res.status(400).json({ 
                error: "Iznos mora biti pozitivni broj." 
            });
        }

        // Validacija načina plaćanja
        const validNacini = ['gotovina', 'kartica', 'virman'];
        if (!validNacini.includes(nacin)) {
            return res.status(400).json({ 
                error: "Način plaćanja mora biti: gotovina, kartica ili virman." 
            });
        }

        // Validacija statusa
        const validStatusi = ['primljena', 'cekanje', 'odbijena'];
        if (!validStatusi.includes(status)) {
            return res.status(400).json({ 
                error: "Status mora biti: primljena, cekanje ili odbijena." 
            });
        }

        // Opcionalna validacija partnera (ako je poslata šifra partnera)
        let validatedKupac = kupac;
        if (partner_sifra) {
            const partnerCheck = await db.query(
                'SELECT "Naziv_partnera" FROM "partneri" WHERE "Sifra" = $1',
                [partner_sifra]
            );
            
            if (partnerCheck.rows.length > 0) {
                validatedKupac = partnerCheck.rows[0].Naziv_partnera;
                console.log(`Partner validated for update: ${partner_sifra} -> ${validatedKupac}`);
            }
        }

        // Opcionalna validacija komercijalista (ako je poslat ID komercijalista)
        let validatedKomercijalist = komercijalist;
        if (komercijalist_id) {
            const komercijalistCheck = await db.query(
                'SELECT "ime_prezime" FROM "komercijalisti" WHERE "id" = $1 AND "status" = \'aktivan\'',
                [komercijalist_id]
            );
            
            if (komercijalistCheck.rows.length > 0) {
                validatedKomercijalist = komercijalistCheck.rows[0].ime_prezime;
                console.log(`Komercijalist validated for update: ${komercijalist_id} -> ${validatedKomercijalist}`);
            }
        }
        
        const result = await db.query(`
            UPDATE "uplate" 
            SET datum = $1, kupac = $2, iznos = $3, nacin = $4, status = $5, 
                dokument = $6, komercijalist = $7, napomene = $8
            WHERE id = $9 
            RETURNING *
        `, [
            datum, 
            validatedKupac, 
            parsedIznos, 
            nacin, 
            status, 
            dokument || null, 
            validatedKomercijalist || null, 
            napomene || null, 
            id
        ]);
        
        console.log(`Payment updated: ID ${id}, Customer: ${validatedKupac}, Amount: €${parsedIznos}`);
        
        res.json({
            message: "Uplata je uspešno ažurirana.",
            uplata: result.rows[0],
            validated: {
                partner_matched: partner_sifra && validatedKupac !== kupac,
                komercijalist_matched: komercijalist_id && validatedKomercijalist !== komercijalist
            }
        });
    } catch (error) {
        console.error("Error updating uplata:", error);
        res.status(500).json({ error: "Greška pri ažuriranju uplate: " + error.message });
    }
});

// DELETE - Obriši uplatu
app.delete("/api/uplate/:id", async(req, res) => {
    try {
        const { id } = req.params;
        
        // Proveri da li uplata postoji
        const existingPayment = await db.query('SELECT * FROM "uplate" WHERE "id" = $1', [id]);
        if (existingPayment.rows.length === 0) {
            return res.status(404).json({ error: "Uplata nije pronađena." });
        }

        const paymentInfo = existingPayment.rows[0];
        
        const result = await db.query('DELETE FROM "uplate" WHERE id = $1 RETURNING *', [id]);
        
        console.log(`Payment deleted: ID ${id}, Customer: ${paymentInfo.kupac}, Amount: €${paymentInfo.iznos}`);
        
        res.json({ 
            message: "Uplata je uspješno obrisana.", 
            uplata: result.rows[0] 
        });
    } catch (error) {
        console.error("Error deleting uplata:", error);
        res.status(500).json({ error: "Greška pri brisanju uplate: " + error.message });
    }
});

// GET - Statistike uplata (poboljšano sa boljim datumskim filtriranjem)
app.get("/api/uplate/stats/summary", async(req, res) => {
    try {
        const { from, to } = req.query;
        
        let dateFilter = '';
        let params = [];
        
        if (from && to) {
            dateFilter = 'WHERE datum >= $1::date AND datum <= $2::date + interval \'23 hours 59 minutes 59 seconds\'';
            params = [from, to];
        } else if (from) {
            dateFilter = 'WHERE datum >= $1::date';
            params = [from];
        } else if (to) {
            dateFilter = 'WHERE datum <= $1::date + interval \'23 hours 59 minutes 59 seconds\'';
            params = [to];
        }
        
        const statsQuery = `
            SELECT 
                COUNT(*) as total_count,
                COALESCE(SUM(CASE WHEN status != 'odbijena' THEN iznos ELSE 0 END), 0) as total_amount,
                COALESCE(SUM(CASE WHEN status = 'primljena' THEN iznos ELSE 0 END), 0) as successful_amount,
                COALESCE(SUM(CASE WHEN status = 'odbijena' THEN iznos ELSE 0 END), 0) as failed_amount,
                COUNT(CASE WHEN status = 'cekanje' THEN 1 END) as pending_count,
                COALESCE(AVG(CASE WHEN status != 'odbijena' THEN iznos END), 0) as avg_payment
            FROM "uplate" ${dateFilter}
        `;
        
        const result = await db.query(statsQuery, params);
        const stats = result.rows[0];
        
        res.json({
            totalPayments: parseFloat(stats.total_amount) || 0,
            paymentCount: parseInt(stats.total_count) || 0,
            avgPayment: parseFloat(stats.avg_payment) || 0,
            pendingPayments: parseInt(stats.pending_count) || 0,
            successfulAmount: parseFloat(stats.successful_amount) || 0,
            failedAmount: parseFloat(stats.failed_amount) || 0
        });
    } catch (error) {
        console.error("Error fetching payment stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika: " + error.message });
    }
});

// GET - Pretraživanje uplata sa naprednim filtriranjem
app.get("/api/uplate/search", async(req, res) => {
    try {
        const { 
            search = '', 
            status = '', 
            nacin = '', 
            datum_od = '', 
            datum_do = '',
            partner_sifra = '',
            komercijalist_id = '',
            limit = 100
        } = req.query;
        
        let query = `
            SELECT u.*, 
                   p."Sifra" as partner_sifra,
                   k.id as komercijalist_id
            FROM "uplate" u
            LEFT JOIN "partneri" p ON p."Naziv_partnera" = u.kupac
            LEFT JOIN "komercijalisti" k ON k.ime_prezime = u.komercijalist
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        // Pretraživanje po tekstu
        if (search) {
            query += ` AND (
                LOWER(u.kupac) LIKE LOWER(${paramIndex}) OR 
                LOWER(u.komercijalist) LIKE LOWER(${paramIndex}) OR 
                LOWER(u.dokument) LIKE LOWER(${paramIndex}) OR
                CAST(u.id AS TEXT) LIKE ${paramIndex} OR
                LOWER(u.napomene) LIKE LOWER(${paramIndex})
            )`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        // Filter po statusu
        if (status) {
            query += ` AND u.status = ${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        // Filter po načinu plaćanja
        if (nacin) {
            query += ` AND u.nacin = ${paramIndex}`;
            params.push(nacin);
            paramIndex++;
        }
        
        // Filter po datumu od
        if (datum_od) {
            query += ` AND u.datum >= ${paramIndex}::date`;
            params.push(datum_od);
            paramIndex++;
        }
        
        // Filter po datumu do
        if (datum_do) {
            query += ` AND u.datum <= ${paramIndex}::date + interval '23 hours 59 minutes 59 seconds'`;
            params.push(datum_do);
            paramIndex++;
        }
        
        // Filter po partneru (šifri)
        if (partner_sifra) {
            query += ` AND p."Sifra" = ${paramIndex}`;
            params.push(partner_sifra);
            paramIndex++;
        }
        
        // Filter po komercijalisti (ID)
        if (komercijalist_id) {
            query += ` AND k.id = ${paramIndex}`;
            params.push(komercijalist_id);
            paramIndex++;
        }
        
        query += ` ORDER BY u.datum DESC, u.id DESC LIMIT ${paramIndex}`;
        params.push(parseInt(limit));
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            uplate: result.rows,
            count: result.rows.length,
            filters: {
                search, status, nacin, datum_od, datum_do, 
                partner_sifra, komercijalist_id, limit
            }
        });
        
    } catch (error) {
        console.error("Error searching payments:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri pretraživanju uplata: " + error.message 
        });
    }
});

// GET - Top kupci po ukupnim uplatama
app.get("/api/uplate/top-customers", async(req, res) => {
    try {
        const { limit = 10, datum_od = '', datum_do = '' } = req.query;
        
        let dateFilter = '';
        let params = [];
        let paramIndex = 1;
        
        if (datum_od) {
            dateFilter += ` AND datum >= ${paramIndex}::date`;
            params.push(datum_od);
            paramIndex++;
        }
        
        if (datum_do) {
            dateFilter += ` AND datum <= ${paramIndex}::date + interval '23 hours 59 minutes 59 seconds'`;
            params.push(datum_do);
            paramIndex++;
        }
        
        const query = `
            SELECT 
                kupac,
                COUNT(*) as broj_uplata,
                SUM(iznos) as ukupan_iznos,
                AVG(iznos) as prosecna_uplata,
                MAX(datum) as poslednja_uplata,
                COUNT(CASE WHEN status = 'primljena' THEN 1 END) as uspesne_uplate,
                p."Sifra" as partner_sifra,
                p."Grad" as partner_grad,
                p."PIB" as partner_pib
            FROM "uplate" u
            LEFT JOIN "partneri" p ON p."Naziv_partnera" = u.kupac
            WHERE status != 'odbijena'${dateFilter}
            GROUP BY kupac, p."Sifra", p."Grad", p."PIB"
            ORDER BY ukupan_iznos DESC
            LIMIT ${paramIndex}
        `;
        
        params.push(parseInt(limit));
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            topCustomers: result.rows,
            period: { datum_od, datum_do }
        });
        
    } catch (error) {
        console.error("Error fetching top customers:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri dohvatanju top kupaca: " + error.message 
        });
    }
});

// GET - Statistike po komercijalistima
app.get("/api/uplate/stats/komercijalisti", async(req, res) => {
    try {
        const { datum_od = '', datum_do = '' } = req.query;
        
        let dateFilter = '';
        let params = [];
        let paramIndex = 1;
        
        if (datum_od) {
            dateFilter += ` AND u.datum >= ${paramIndex}::date`;
            params.push(datum_od);
            paramIndex++;
        }
        
        if (datum_do) {
            dateFilter += ` AND u.datum <= ${paramIndex}::date + interval '23 hours 59 minutes 59 seconds'`;
            params.push(datum_do);
            paramIndex++;
        }
        
        const query = `
            SELECT 
                u.komercijalist,
                k.id as komercijalist_id,
                k.status as komercijalist_status,
                COUNT(*) as broj_uplata,
                SUM(u.iznos) as ukupan_iznos,
                AVG(u.iznos) as prosecna_uplata,
                COUNT(DISTINCT u.kupac) as broj_kupaca,
                COUNT(CASE WHEN u.status = 'primljena' THEN 1 END) as uspesne_uplate,
                COUNT(CASE WHEN u.status = 'cekanje' THEN 1 END) as uplate_na_cekanju,
                COUNT(CASE WHEN u.status = 'odbijena' THEN 1 END) as odbijene_uplate
            FROM "uplate" u
            LEFT JOIN "komercijalisti" k ON k.ime_prezime = u.komercijalist
            WHERE u.komercijalist IS NOT NULL AND u.komercijalist != ''${dateFilter}
            GROUP BY u.komercijalist, k.id, k.status
            ORDER BY ukupan_iznos DESC
        `;
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            komercijalistiStats: result.rows,
            period: { datum_od, datum_do }
        });
        
    } catch (error) {
        console.error("Error fetching komercijalisti stats:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri dohvatanju statistika komercijalista: " + error.message 
        });
    }
});

// GET - Mesečni pregled uplata
app.get("/api/uplate/stats/monthly", async(req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;
        
        const query = `
            SELECT 
                EXTRACT(MONTH FROM datum) as mesec,
                TO_CHAR(datum, 'Month') as naziv_meseca,
                COUNT(*) as broj_uplata,
                SUM(iznos) as ukupan_iznos,
                AVG(iznos) as prosecna_uplata,
                COUNT(CASE WHEN status = 'primljena' THEN 1 END) as uspesne_uplate,
                COUNT(CASE WHEN status = 'cekanje' THEN 1 END) as uplate_na_cekanju,
                COUNT(CASE WHEN status = 'odbijena' THEN 1 END) as odbijene_uplate,
                COUNT(DISTINCT kupac) as broj_kupaca
            FROM "uplate"
            WHERE EXTRACT(YEAR FROM datum) = $1
            GROUP BY EXTRACT(MONTH FROM datum), TO_CHAR(datum, 'Month')
            ORDER BY mesec
        `;
        
        const result = await db.query(query, [year]);
        
        // Popuni sve mesece (1-12) sa nulama ako nema podataka
        const allMonths = [];
        const monthNames = [
            'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun',
            'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'
        ];
        
        for (let i = 1; i <= 12; i++) {
            const existingMonth = result.rows.find(row => parseInt(row.mesec) === i);
            if (existingMonth) {
                allMonths.push({
                    ...existingMonth,
                    mesec: i,
                    naziv_meseca: monthNames[i - 1]
                });
            } else {
                allMonths.push({
                    mesec: i,
                    naziv_meseca: monthNames[i - 1],
                    broj_uplata: 0,
                    ukupan_iznos: 0,
                    prosecna_uplata: 0,
                    uspesne_uplate: 0,
                    uplate_na_cekanju: 0,
                    odbijene_uplate: 0,
                    broj_kupaca: 0
                });
            }
        }
        
        res.json({
            success: true,
            monthlyStats: allMonths,
            year: parseInt(year)
        });
        
    } catch (error) {
        console.error("Error fetching monthly stats:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri dohvatanju mesečnih statistika: " + error.message 
        });
    }
});

// POST - Bulk import uplata (CSV import funkcionalnost)
app.post("/api/uplate/bulk-import", async(req, res) => {
    try {
        const { uplate } = req.body;
        
        if (!uplate || !Array.isArray(uplate) || uplate.length === 0) {
            return res.status(400).json({ 
                error: "Lista uplata za import je obavezna." 
            });
        }
        
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };
        
        await db.query('BEGIN');
        
        for (let i = 0; i < uplate.length; i++) {
            const uplata = uplate[i];
            
            try {
                // Validacija osnovnih polja
                if (!uplata.datum || !uplata.kupac || !uplata.iznos || !uplata.nacin) {
                    throw new Error(`Red ${i + 1}: Nedostaju obavezna polja`);
                }
                
                const parsedIznos = parseFloat(uplata.iznos);
                if (isNaN(parsedIznos) || parsedIznos <= 0) {
                    throw new Error(`Red ${i + 1}: Nevaljan iznos`);
                }
                
                const validNacini = ['gotovina', 'kartica', 'virman'];
                if (!validNacini.includes(uplata.nacin)) {
                    throw new Error(`Red ${i + 1}: Nevaljan način plaćanja`);
                }
                
                const validStatusi = ['primljena', 'cekanje', 'odbijena'];
                const status = uplata.status || 'primljena';
                if (!validStatusi.includes(status)) {
                    throw new Error(`Red ${i + 1}: Nevaljan status`);
                }
                
                await db.query(`
                    INSERT INTO "uplate" (datum, kupac, iznos, nacin, status, dokument, komercijalist, napomene) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    uplata.datum,
                    uplata.kupac,
                    parsedIznos,
                    uplata.nacin,
                    status,
                    uplata.dokument || null,
                    uplata.komercijalist || null,
                    uplata.napomene || null
                ]);
                
                results.success++;
                
            } catch (error) {
                results.failed++;
                results.errors.push(`Red ${i + 1}: ${error.message}`);
            }
        }
        
        await db.query('COMMIT');
        
        res.json({
            success: true,
            message: `Import završen. Uspešno: ${results.success}, Neuspešno: ${results.failed}`,
            results: results
        });
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error bulk importing payments:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri bulk importu: " + error.message 
        });
    }
});

// DELETE - Bulk brisanje uplata
app.delete("/api/uplate/bulk-delete", async(req, res) => {
    try {
        const { ids } = req.body;
        
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ 
                error: "Lista ID-jeva za brisanje je obavezna." 
            });
        }
        
        const placeholders = ids.map((_, index) => `${index + 1}`).join(',');
        
        const result = await db.query(
            `DELETE FROM "uplate" WHERE id IN (${placeholders}) RETURNING id, kupac, iznos`,
            ids
        );
        
        console.log(`Bulk deleted ${result.rowCount} payments`);
        
        res.json({
            success: true,
            message: `Uspešno obrisano ${result.rowCount} uplata.`,
            deletedCount: result.rowCount,
            deletedPayments: result.rows
        });
        
    } catch (error) {
        console.error("Error bulk deleting payments:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri bulk brisanju: " + error.message 
        });
    }
});

// PUT - Bulk ažuriranje statusa uplata
app.put("/api/uplate/bulk-status", async(req, res) => {
    try {
        const { ids, status } = req.body;
        
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ 
                error: "Lista ID-jeva je obavezna." 
            });
        }
        
        const validStatusi = ['primljena', 'cekanje', 'odbijena'];
        if (!validStatusi.includes(status)) {
            return res.status(400).json({ 
                error: "Status mora biti: primljena, cekanje ili odbijena." 
            });
        }
        
        const placeholders = ids.map((_, index) => `${index + 2}`).join(',');
        
        const result = await db.query(
            `UPDATE "uplate" SET status = $1 WHERE id IN (${placeholders}) RETURNING id, kupac, status`,
            [status, ...ids]
        );
        
        console.log(`Bulk updated status to '${status}' for ${result.rowCount} payments`);
        
        res.json({
            success: true,
            message: `Uspešno ažuriran status za ${result.rowCount} uplata na '${status}'.`,
            updatedCount: result.rowCount,
            updatedPayments: result.rows
        });
        
    } catch (error) {
        console.error("Error bulk updating payment status:", error);
        res.status(500).json({ 
            success: false, 
            error: "Greška pri bulk ažuriranju statusa: " + error.message 
        });
    }
});
// SERVIS ROUTES SA SERVISERI INTEGRACIJOM

// Helper funkcije za normalizaciju
function normalizePrioritet(val) {
    const map = {
        'nizak': 'Nizak',
        'srednji': 'Srednji', 
        'visok': 'Visok',
        'hitan': 'Hitan'
    };
    if (!val) return 'Srednji'; // default
    const lower = String(val).trim().toLowerCase();
    return map[lower] || 'Srednji';
}

function normalizeGarancija(val) {
    const map = {
        'u-garanciji': 'U garanciji',
        'u garanciji': 'U garanciji',
        'van-garancije': 'Van garancije',
        'van garancije': 'Van garancije',
        'proverava-se': 'Proverava se',
        'proverava se': 'Proverava se'
    };
    if (!val) return 'Proverava se'; // default
    const lower = String(val).trim().toLowerCase();
    return map[lower] || 'Proverava se';
}

// GET - Lista svih servisa sa serviseri podacima
// GET - Lista servisa (serviser vidi samo svoje servise)
app.get("/servis", async (req, res) => {
  try {
    // Ako je ulogovani korisnik 'servis', prikaži samo servise dodeljene njemu
    let servisiQuery = `
      SELECT 
        id,
        broj_servisa,
        ime_kupca,
        telefon,
        email,
        proizvod_model,
        serijski_broj,
        status_garancije,
        opis_kvara,
        tehnicar,
        prioritet,
        procenjena_cena,
        napomene,
        datum_kreiranja,
        status
      FROM servisi
    `;
    const params = [];

    if (req.session && req.session.role === 'servis' && req.session.username) {
      servisiQuery += ` WHERE tehnicar = $1`;
      params.push(req.session.username);
    }

    servisiQuery += ` ORDER BY datum_kreiranja DESC`;

    const servisi = (await db.query(servisiQuery, params)).rows;

    // Učitaj sve servisere (filter/dropdown)
    const serviseri = (await db.query(
      'SELECT id, ime_servisera FROM serviseri ORDER BY ime_servisera'
    )).rows;

    console.log(`Loaded ${servisi.length} services and ${serviseri.length} serviseri (user: ${req.session ? req.session.username : 'anon'})`);

    res.render("servis.ejs", {
      servisi: servisi,
      serviseri: serviseri,
      title: 'Servis'
    });
  } catch (error) {
    console.error("Error fetching servisi and serviseri:", error);
    res.status(500).send("Greška pri dohvatanju servisa.");
  }
});


// POST - Create new service sa serviseri validacijom
app.post("/servis/add", async (req, res) => {
    try {
        const {
            ime_kupca,
            telefon,
            email,
            proizvod_model,
            serijski_broj,
            status_garancije,
            opis_kvara,
            tehnicar,
            prioritet,
            procenjena_cena,
            napomene
        } = req.body;
        
        // Validacija osnovnih polja
        if (!ime_kupca || !telefon || !proizvod_model || !serijski_broj || !opis_kvara) {
            return res.status(400).json({
                success: false,
                message: "Ime kupca, telefon, proizvod/model, serijski broj i opis kvara su obavezni."
            });
        }
        
        // Validacija servisera (mora postojati u tabeli serviseri)
        if (!tehnicar) {
            return res.status(400).json({
                success: false,
                message: "Serviser je obavezan."
            });
        }
        
        const serviserCheck = await db.query(
            'SELECT id FROM serviseri WHERE ime_servisera = $1',
            [tehnicar]
        );
        
        if (serviserCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Odabrani serviser nije pronađen u sistemu."
            });
        }
        
        // Normalizacija vrednosti
        const prioritetNorm = normalizePrioritet(prioritet);
        const statusGarancijeNorm = normalizeGarancija(status_garancije);

        // Get next service number
        const maxResult = await db.query(
            'SELECT COALESCE(MAX(CAST(broj_servisa AS INTEGER)), 0) as max_broj FROM servisi'
        );
        const nextNumber = String(maxResult.rows[0].max_broj + 1).padStart(3, '0');
        
        // Validacija procenjene cene
        const cenaValue = parseFloat(procenjena_cena) || 0;
        if (cenaValue < 0) {
            return res.status(400).json({
                success: false,
                message: "Procenjena cena ne može biti negativna."
            });
        }
        
        // Insert new service
        const result = await db.query(`
            INSERT INTO servisi (
                broj_servisa,
                ime_kupca,
                telefon,
                email,
                proizvod_model,
                serijski_broj,
                status_garancije,
                opis_kvara,
                tehnicar,
                prioritet,
                procenjena_cena,
                napomene,
                datum_kreiranja,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 'primljen')
            RETURNING id
        `, [
            nextNumber,
            ime_kupca.trim(),
            telefon.trim(),
            email ? email.trim() : null,
            proizvod_model.trim(),
            serijski_broj.trim(),
            statusGarancijeNorm,
            opis_kvara.trim(),
            tehnicar.trim(),
            prioritetNorm,
            cenaValue,
            napomene ? napomene.trim() : null
        ]);
        
        console.log(`New service created: ID ${result.rows[0].id}, Number: ${nextNumber}, Serviser: ${tehnicar}`);
        
        res.json({ 
            success: true, 
            message: 'Novi servisni zahtev je uspešno kreiran.',
            serviceId: result.rows[0].id,
            serviceNumber: nextNumber
        });
        
    } catch (error) {
        console.error('Error adding service:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri kreiranju servisa: ' + error.message 
        });
    }
});

// PUT - Update service sa serviseri validacijom
app.put("/servis/update/:id", async (req, res) => {
    try {
        const serviceId = req.params.id;
        const {
            ime_kupca,
            telefon,
            email,
            proizvod_model,
            serijski_broj,
            status_garancije,
            opis_kvara,
            tehnicar,
            prioritet,
            procenjena_cena,
            napomene
        } = req.body;

        // Proveri da li servis postoji
        const existingService = await db.query(
            'SELECT id FROM servisi WHERE id = $1',
            [serviceId]
        );
        
        if (existingService.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Servis nije pronađen."
            });
        }
        
        // Validacija osnovnih polja
        if (!ime_kupca || !telefon || !proizvod_model || !serijski_broj || !opis_kvara) {
            return res.status(400).json({
                success: false,
                message: "Ime kupca, telefon, proizvod/model, serijski broj i opis kvara su obavezni."
            });
        }
        
        // Validacija servisera (mora postojati u tabeli serviseri)
        if (!tehnicar) {
            return res.status(400).json({
                success: false,
                message: "Serviser je obavezan."
            });
        }
        
        const serviserCheck = await db.query(
            'SELECT id FROM serviseri WHERE ime_servisera = $1',
            [tehnicar]
        );
        
        if (serviserCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Odabrani serviser nije pronađen u sistemu."
            });
        }

        // Normalizacija vrednosti
        const prioritetNorm = normalizePrioritet(prioritet);
        const statusGarancijeNorm = normalizeGarancija(status_garancije);
        
        // Validacija procenjene cene
        const cenaValue = parseFloat(procenjena_cena) || 0;
        if (cenaValue < 0) {
            return res.status(400).json({
                success: false,
                message: "Procenjena cena ne može biti negativna."
            });
        }
        
        await db.query(`
            UPDATE servisi SET
                ime_kupca = $1,
                telefon = $2,
                email = $3,
                proizvod_model = $4,
                serijski_broj = $5,
                status_garancije = $6,
                opis_kvara = $7,
                tehnicar = $8,
                prioritet = $9,
                procenjena_cena = $10,
                napomene = $11
            WHERE id = $12
        `, [
            ime_kupca.trim(),
            telefon.trim(),
            email ? email.trim() : null,
            proizvod_model.trim(),
            serijski_broj.trim(),
            statusGarancijeNorm,
            opis_kvara.trim(),
            tehnicar.trim(),
            prioritetNorm,
            cenaValue,
            napomene ? napomene.trim() : null,
            serviceId
        ]);
        
        console.log(`Service updated: ID ${serviceId}, Serviser: ${tehnicar}`);
        
        res.json({ 
            success: true, 
            message: 'Servisni zahtev je uspešno ažuriran.' 
        });
        
    } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri ažuriranju servisa: ' + error.message 
        });
    }
});

// PUT - Update service status
app.put("/servis/status/:id", async (req, res) => {
    try {
        const serviceId = req.params.id;
        const { status, napomena, finalna_cena } = req.body;
        
        // Validacija statusa
        const validStatusi = ['primljen', 'u-radu', 'ceka-deo', 'gotov', 'isporucen'];
        if (!validStatusi.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Nevaljan status. Dozvoljeni su: " + validStatusi.join(', ')
            });
        }
        
        // Proveri da li servis postoji
        const existingService = await db.query(
            'SELECT id, status as current_status FROM servisi WHERE id = $1',
            [serviceId]
        );
        
        if (existingService.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Servis nije pronađen."
            });
        }
        
        let updateQuery = 'UPDATE servisi SET status = $1';
        let params = [status];
        let paramIndex = 2;
        
        if (napomena) {
            updateQuery += `, napomene = CONCAT(COALESCE(napomene, ''), $${paramIndex})`;
            params.push(`\n---\nStatus promena (${new Date().toLocaleDateString('sr-RS')}): ${napomena}`);
            paramIndex++;
        }
        
        if (finalna_cena && (status === 'gotov' || status === 'isporucen')) {
            const finalCost = parseFloat(finalna_cena);
            if (finalCost >= 0) {
                updateQuery += `, procenjena_cena = $${paramIndex}`;
                params.push(finalCost);
                paramIndex++;
            }
        }
        
        updateQuery += ` WHERE id = $${paramIndex}`;
        params.push(serviceId);
        
        await db.query(updateQuery, params);
        
        const statusNames = {
            'primljen': 'Primljen',
            'u-radu': 'U radu',
            'ceka-deo': 'Čeka deo',
            'gotov': 'Gotov',
            'isporucen': 'Isporučen'
        };
        
        console.log(`Service status updated: ID ${serviceId}, Status: ${status}`);
        
        res.json({ 
            success: true, 
            message: `Status servisa je promenjen na "${statusNames[status]}".`,
            newStatus: status
        });
        
    } catch (error) {
        console.error('Error updating service status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri promeni statusa: ' + error.message 
        });
    }
});

// DELETE - Delete service
app.delete("/servis/delete/:id", async (req, res) => {
    try {
        const serviceId = req.params.id;
        
        // Check if service exists
        const serviceCheck = await db.query(
            'SELECT id, broj_servisa, ime_kupca FROM servisi WHERE id = $1',
            [serviceId]
        );
        
        if (serviceCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Servis nije pronađen.' 
            });
        }
        
        const service = serviceCheck.rows[0];
        
        // Delete the service
        await db.query('DELETE FROM servisi WHERE id = $1', [serviceId]);
        
        console.log(`Service deleted: ID ${serviceId}, Number: ${service.broj_servisa}, Customer: ${service.ime_kupca}`);
        
        res.json({ 
            success: true, 
            message: 'Servisni zahtev je uspešno obrisan.' 
        });
        
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri brisanju servisa: ' + error.message 
        });
    }
});

// GET - Get service data for editing
app.get("/servis/get/:id", async (req, res) => {
    try {
        const serviceId = req.params.id;
        
        const result = await db.query(
            `SELECT 
                id, broj_servisa, ime_kupca, telefon, email, proizvod_model,
                serijski_broj, status_garancije, opis_kvara, tehnicar,
                prioritet, procenjena_cena, napomene, datum_kreiranja, status
            FROM servisi WHERE id = $1`,
            [serviceId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Servis nije pronađen.' 
            });
        }
        
        // Proveri da li serviser još uvek postoji u sistemu
        const service = result.rows[0];
        if (service.tehnicar) {
            const serviserCheck = await db.query(
                'SELECT id FROM serviseri WHERE ime_servisera = $1',
                [service.tehnicar]
            );
            
            if (serviserCheck.rows.length === 0) {
                console.warn(`Service ${serviceId} has assigned serviser '${service.tehnicar}' who no longer exists in serviseri table`);
            }
        }
        
        res.json({ 
            success: true, 
            service: service 
        });
        
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri učitavanju servisa: ' + error.message 
        });
    }
});

// GET - Get next service number
app.get("/servis/next-number", async (req, res) => {
    try {
        const maxResult = await db.query(
            'SELECT COALESCE(MAX(CAST(broj_servisa AS INTEGER)), 0) as max_broj FROM servisi'
        );
        const nextNumber = String(maxResult.rows[0].max_broj + 1).padStart(3, '0');
        
        res.json({ 
            success: true, 
            nextNumber: nextNumber 
        });
        
    } catch (error) {
        console.error('Error getting next service number:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri dobijanju broja servisa: ' + error.message,
            nextNumber: '001'
        });
    }
});

// GET - Search and filter services sa serviseri filterom
app.get("/servis/search", async (req, res) => {
    try {
        const { search = '', status = '', serviser = '' } = req.query;
        
        let query = `
            SELECT 
                id, broj_servisa, ime_kupca, telefon, email, proizvod_model,
                serijski_broj, status_garancije, opis_kvara, tehnicar,
                prioritet, procenjena_cena, napomene, datum_kreiranja, status
            FROM servisi 
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (search) {
            query += ` AND (ime_kupca ILIKE ${paramIndex} OR proizvod_model ILIKE ${paramIndex} OR opis_kvara ILIKE ${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        if (status) {
            query += ` AND status = ${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        if (serviser) {
            query += ` AND tehnicar = ${paramIndex}`;
            params.push(serviser);
            paramIndex++;
        }
        
        query += ` ORDER BY datum_kreiranja DESC`;
        
        const result = await db.query(query, params);
        
        res.json({ 
            success: true, 
            services: result.rows 
        });
        
    } catch (error) {
        console.error('Error searching services:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri pretraživanju: ' + error.message 
        });
    }
});

// GET - Service statistics sa serviseri breakdown
app.get("/api/servis/stats", async (req, res) => {
    try {
        const { datum_od, datum_do } = req.query;
        
        let dateFilter = '';
        let queryParams = [];
        let paramCount = 0;
        
        if (datum_od) {
            paramCount++;
            dateFilter += ` AND datum_kreiranja >= ${paramCount}`;
            queryParams.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            dateFilter += ` AND datum_kreiranja <= ${paramCount}`;
            queryParams.push(datum_do);
        }

        // Osnovne statistike servisa
        const basicStats = await db.query(`
            SELECT 
                COUNT(*) as total_services,
                COUNT(CASE WHEN status = 'primljen' THEN 1 END) as primljeni,
                COUNT(CASE WHEN status = 'u-radu' THEN 1 END) as u_radu,
                COUNT(CASE WHEN status = 'ceka-deo' THEN 1 END) as ceka_deo,
                COUNT(CASE WHEN status = 'gotov' THEN 1 END) as gotovi,
                COUNT(CASE WHEN status = 'isporucen' THEN 1 END) as isporuceni,
                COALESCE(AVG(procenjena_cena), 0) as avg_cost,
                COALESCE(SUM(procenjena_cena), 0) as total_cost
            FROM servisi 
            WHERE 1=1${dateFilter}
        `, queryParams);

        // Statistike po serviserima
        const serviserStats = await db.query(`
            SELECT 
                s.tehnicar,
                COUNT(s.id) as broj_servisa,
                COUNT(CASE WHEN s.status = 'gotov' OR s.status = 'isporucen' THEN 1 END) as zavrseni_servisi,
                COALESCE(AVG(s.procenjena_cena), 0) as prosecna_cena,
                COALESCE(SUM(s.procenjena_cena), 0) as ukupna_vrednost,
                sr.id as serviser_id
            FROM servisi s
            LEFT JOIN serviseri sr ON sr.ime_servisera = s.tehnicar
            WHERE s.tehnicar IS NOT NULL${dateFilter}
            GROUP BY s.tehnicar, sr.id
            ORDER BY broj_servisa DESC
        `, queryParams);

        // Najčešći problemi/kvrarovi
        const commonProblems = await db.query(`
            SELECT 
                SUBSTRING(opis_kvara, 1, 50) as problem_preview,
                COUNT(*) as frequency
            FROM servisi 
            WHERE opis_kvara IS NOT NULL${dateFilter}
            GROUP BY SUBSTRING(opis_kvara, 1, 50)
            ORDER BY frequency DESC
            LIMIT 10
        `, queryParams);

        res.json({
            success: true,
            basic_stats: basicStats.rows[0],
            serviser_stats: serviserStats.rows,
            common_problems: commonProblems.rows,
            period: { datum_od, datum_do }
        });

    } catch (error) {
        console.error("Error fetching service stats:", error);
        res.status(500).json({ 
            success: false, 
            message: "Greška pri dohvatanju statistika servisa." 
        });
    }
});

// GET - Lista servisa po serviseru
app.get("/api/servis/by-serviser/:serviser", async (req, res) => {
    try {
        const { serviser } = req.params;
        const { datum_od, datum_do, status = '', limit = 50 } = req.query;
        
        // Proveri da li serviser postoji
        const serviserCheck = await db.query(
            'SELECT id FROM serviseri WHERE ime_servisera = $1',
            [serviser]
        );
        
        if (serviserCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Serviser nije pronađen."
            });
        }
        
        let query = `
            SELECT 
                id, broj_servisa, ime_kupca, telefon, proizvod_model,
                opis_kvara, status, procenjena_cena, datum_kreiranja
            FROM servisi 
            WHERE tehnicar = $1
        `;
        const params = [serviser];
        let paramIndex = 2;
        
        if (datum_od) {
            query += ` AND datum_kreiranja >= ${paramIndex}`;
            params.push(datum_od);
            paramIndex++;
        }
        
        if (datum_do) {
            query += ` AND datum_kreiranja <= ${paramIndex}`;
            params.push(datum_do);
            paramIndex++;
        }
        
        if (status) {
            query += ` AND status = ${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        query += ` ORDER BY datum_kreiranja DESC LIMIT ${paramIndex}`;
        params.push(parseInt(limit));
        
        const services = await db.query(query, params);
        
        res.json({
            success: true,
            serviser: serviser,
            services: services.rows,
            count: services.rows.length,
            filters: { datum_od, datum_do, status, limit }
        });
        
    } catch (error) {
        console.error('Error fetching services by serviser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri dohvatanju servisa po serviseru: ' + error.message 
        });
    }
});

// SERVISERI MANAGEMENT ROUTES

// GET - Lista svih servisera
app.get("/api/serviseri", async (req, res) => {
    try {
        const serviseri = await db.query(
            'SELECT id, ime_servisera FROM serviseri ORDER BY ime_servisera'
        );
        
        res.json({
            success: true,
            serviseri: serviseri.rows
        });
        
    } catch (error) {
        console.error('Error fetching serviseri:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri dohvatanju servisera: ' + error.message 
        });
    }
});

// POST - Dodaj novog servisera
app.post("/api/serviseri", async (req, res) => {
    try {
        const { ime_servisera } = req.body;
        
        if (!ime_servisera || !ime_servisera.trim()) {
            return res.status(400).json({
                success: false,
                message: "Ime servisera je obavezno."
            });
        }
        
        // Proveri da li serviser već postoji
        const existingServiser = await db.query(
            'SELECT id FROM serviseri WHERE LOWER(ime_servisera) = LOWER($1)',
            [ime_servisera.trim()]
        );
        
        if (existingServiser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Serviser sa tim imenom već postoji."
            });
        }
        
        const result = await db.query(
            'INSERT INTO serviseri (ime_servisera) VALUES ($1) RETURNING id',
            [ime_servisera.trim()]
        );
        
        console.log(`New serviser created: ID ${result.rows[0].id}, Name: ${ime_servisera}`);
        
        res.status(201).json({
            success: true,
            message: "Serviser je uspešno dodat.",
            serviser: {
                id: result.rows[0].id,
                ime_servisera: ime_servisera.trim()
            }
        });
        
    } catch (error) {
        console.error('Error adding serviser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri dodavanju servisera: ' + error.message 
        });
    }
});

// PUT - Ažuriraj servisera
app.put("/api/serviseri/:id", async (req, res) => {
    try {
        const serviserId = req.params.id;
        const { ime_servisera } = req.body;
        
        if (!ime_servisera || !ime_servisera.trim()) {
            return res.status(400).json({
                success: false,
                message: "Ime servisera je obavezno."
            });
        }
        
        // Proveri da li serviser postoji
        const existingServiser = await db.query(
            'SELECT id, ime_servisera FROM serviseri WHERE id = $1',
            [serviserId]
        );
        
        if (existingServiser.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Serviser nije pronađen."
            });
        }
        
        const oldName = existingServiser.rows[0].ime_servisera;
        
        // Proveri da li novo ime već postoji (osim trenutnog servisera)
        const duplicateCheck = await db.query(
            'SELECT id FROM serviseri WHERE LOWER(ime_servisera) = LOWER($1) AND id != $2',
            [ime_servisera.trim(), serviserId]
        );
        
        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Serviser sa tim imenom već postoji."
            });
        }
        
        // Ažuriraj servisera
        await db.query(
            'UPDATE serviseri SET ime_servisera = $1 WHERE id = $2',
            [ime_servisera.trim(), serviserId]
        );
        
        // Ažuriraj sve servise koji koriste staro ime
        await db.query(
            'UPDATE servisi SET tehnicar = $1 WHERE tehnicar = $2',
            [ime_servisera.trim(), oldName]
        );
        
        console.log(`Serviser updated: ID ${serviserId}, Old: ${oldName}, New: ${ime_servisera}`);
        
        res.json({
            success: true,
            message: "Serviser je uspešno ažuriran. Svi povezani servisi su takođe ažurirani.",
            serviser: {
                id: serviserId,
                ime_servisera: ime_servisera.trim()
            },
            updated_services: true
        });
        
    } catch (error) {
        console.error('Error updating serviser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri ažuriranju servisera: ' + error.message 
        });
    }
});

// DELETE - Obriši servisera
app.delete("/api/serviseri/:id", async (req, res) => {
    try {
        const serviserId = req.params.id;
        
        // Proveri da li serviser postoji
        const existingServiser = await db.query(
            'SELECT id, ime_servisera FROM serviseri WHERE id = $1',
            [serviserId]
        );
        
        if (existingServiser.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Serviser nije pronađen."
            });
        }
        
        const serviser = existingServiser.rows[0];
        
        // Proveri da li serviser ima aktivne servise
        const activeServicesCheck = await db.query(
            'SELECT COUNT(*) as count FROM servisi WHERE tehnicar = $1 AND status NOT IN (\'gotov\', \'isporucen\')',
            [serviser.ime_servisera]
        );
        
        const activeServicesCount = parseInt(activeServicesCheck.rows[0].count);
        
        if (activeServicesCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Ne možete obrisati servisera "${serviser.ime_servisera}" jer ima ${activeServicesCount} aktivnih servisa.`
            });
        }
        
        // Proveri ukupan broj servisa
        const totalServicesCheck = await db.query(
            'SELECT COUNT(*) as count FROM servisi WHERE tehnicar = $1',
            [serviser.ime_servisera]
        );
        
        const totalServicesCount = parseInt(totalServicesCheck.rows[0].count);
        
        if (totalServicesCount > 0) {
            // Postavi tehnicar na NULL za sve servise ovog servisera
            await db.query(
                'UPDATE servisi SET tehnicar = NULL WHERE tehnicar = $1',
                [serviser.ime_servisera]
            );
            
            console.log(`Set ${totalServicesCount} services to NULL technician for deleted serviser: ${serviser.ime_servisera}`);
        }
        
        // Obriši servisera
        await db.query('DELETE FROM serviseri WHERE id = $1', [serviserId]);
        
        console.log(`Serviser deleted: ID ${serviserId}, Name: ${serviser.ime_servisera}`);
        
        res.json({
            success: true,
            message: `Serviser "${serviser.ime_servisera}" je uspešno obrisan.${totalServicesCount > 0 ? ` ${totalServicesCount} servisa je ažurirano.` : ''}`,
            deleted_serviser: serviser.ime_servisera,
            updated_services_count: totalServicesCount
        });
        
    } catch (error) {
        console.error('Error deleting serviser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri brisanju servisera: ' + error.message 
        });
    }
});

// BULK OPERATIONS

// PUT - Bulk promena statusa servisa
app.put("/api/servis/bulk-status", async (req, res) => {
    try {
        const { service_ids, new_status } = req.body;
        
        if (!service_ids || !Array.isArray(service_ids) || service_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Lista ID-jeva servisa je obavezna."
            });
        }
        
        const validStatusi = ['primljen', 'u-radu', 'ceka-deo', 'gotov', 'isporucen'];
        if (!validStatusi.includes(new_status)) {
            return res.status(400).json({
                success: false,
                message: "Nevaljan status. Dozvoljeni su: " + validStatusi.join(', ')
            });
        }
        
        const placeholders = service_ids.map((_, index) => `${index + 2}`).join(',');
        
        const result = await db.query(
            `UPDATE servisi SET status = $1 WHERE id IN (${placeholders}) RETURNING id, broj_servisa`,
            [new_status, ...service_ids]
        );
        
        const statusNames = {
            'primljen': 'Primljen',
            'u-radu': 'U radu',
            'ceka-deo': 'Čeka deo',
            'gotov': 'Gotov',
            'isporucen': 'Isporučen'
        };
        
        console.log(`Bulk status update: ${result.rowCount} services updated to ${new_status}`);
        
        res.json({
            success: true,
            message: `Status je uspešno promenjen za ${result.rowCount} servisa na "${statusNames[new_status]}".`,
            updated_count: result.rowCount,
            updated_services: result.rows
        });
        
    } catch (error) {
        console.error('Error bulk updating service status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri bulk ažuriranju statusa: ' + error.message 
        });
    }
});

// PUT - Bulk promena servisera
app.put("/api/servis/bulk-serviser", async (req, res) => {
    try {
        const { service_ids, new_serviser } = req.body;
        
        if (!service_ids || !Array.isArray(service_ids) || service_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Lista ID-jeva servisa je obavezna."
            });
        }
        
        if (!new_serviser) {
            return res.status(400).json({
                success: false,
                message: "Novi serviser je obavezan."
            });
        }
        
        // Proveri da li serviser postoji
        const serviserCheck = await db.query(
            'SELECT id FROM serviseri WHERE ime_servisera = $1',
            [new_serviser]
        );
        
        if (serviserCheck.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Odabrani serviser nije pronađen u sistemu."
            });
        }
        
        const placeholders = service_ids.map((_, index) => `${index + 2}`).join(',');
        
        const result = await db.query(
            `UPDATE servisi SET tehnicar = $1 WHERE id IN (${placeholders}) RETURNING id, broj_servisa`,
            [new_serviser, ...service_ids]
        );
        
        console.log(`Bulk serviser update: ${result.rowCount} services assigned to ${new_serviser}`);
        
        res.json({
            success: true,
            message: `${result.rowCount} servisa je uspešno dodeljeno serviseru "${new_serviser}".`,
            updated_count: result.rowCount,
            updated_services: result.rows,
            new_serviser: new_serviser
        });
        
    } catch (error) {
        console.error('Error bulk updating service serviser:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Greška pri bulk ažuriranju servisera: ' + error.message 
        });
    }
});
app.listen(port, () =>{
    console.log("Server spreman na portu " + port);
});