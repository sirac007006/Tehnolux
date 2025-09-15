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
const ADMIN_HASH = '$2b$12$GlMBYvuE3/jZuhfrZcagXOv.w3uVmwQEo5hdhqlpXtw9mOTbyfgfa';
const SERVIS_HASH = '$2b$12$ztQ6n4HizuDrK59ujHGid.dQ2nz1Tt3fBdq4RPsKPQpnX6Z4XOETa';
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

// Middleware that restricts access based on role stored in session
app.use((req, res, next) => {
  // allow static files (public folder) and public routes
  const url = req.path;

  if (PUBLIC_PATHS.has(url) || url.startsWith('/public') || url.startsWith('/api/public')) {
    return next();
  }

  // if no session role, redirect to login
  if (!req.session || !req.session.role) {
    return res.redirect('/');
  }

  // admin can access everything
  if (req.session.role === 'admin') return next();

  // servis can access only /servis routes and its subpaths
  if (req.session.role === 'servis') {
    if (url === '/servis' || url.startsWith('/servis/')) return next();
    // optionally allow some ajax endpoints used by servis UI here
    return res.status(403).send('Pristup zabranjen za servis nalog.');
  }

  // default deny
  return res.status(403).send('Pristup zabranjen.');
});

// Login page (GET) - render view or send form
app.get('/', (req, res) => {
  // if already logged in, redirect appropriately
  if (req.session && req.session.role === 'admin') return res.redirect('/partneri'); // example
  if (req.session && req.session.role === 'servis') return res.redirect('/servis');

  // render EJS login form (see example below)
  return res.render('login.ejs', { message: null });
});

// Login handler (POST)
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.render('login.ejs', { message: 'Korisničko ime i lozinka su obavezni.' });
  }

  try {
    if (username === 'admin') {
      const match = await bcrypt.compare(password, ADMIN_HASH);
      if (match) {
        req.session.role = 'admin';
        req.session.username = 'admin';
        return res.redirect('/partneri'); // ili neka početna ruta za admina
      }
    }

    if (username === 'servis') {
      const match = await bcrypt.compare(password, SERVIS_HASH);
      if (match) {
        req.session.role = 'servis';
        req.session.username = 'servis';
        return res.redirect('/servis');
      }
    }

    // failed login
    return res.render('login.ejs', { message: 'Neispravno korisničko ime ili lozinka.' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).send('Server error prilikom prijave.');
  }
});
// Logout (GET) - kada se ode na domen.com/logout
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('sid');
    return res.redirect('/');
  });
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('sid');
    return res.redirect('/');
  });
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

// ARTIKLI ROUTES - UPDATED FOR SIMPLIFIED STRUCTURE (only 4 columns)

// Prikaz svih artikala
// ARTIKLI ROUTES - UPDATED FOR CONSISTENT COLUMN NAMING (sifra, naziv, jm, vrsta)

// Prikaz svih artikala
app.get("/artikli", async (req, res) => {
    try {
        const artikli = (await db.query('SELECT * FROM artikli ORDER BY sifra')).rows;
        res.render("artikli.ejs", { artikli });
    } catch (error) {
        console.error("Error fetching artikli:", error);
        res.status(500).send("Greška pri dohvatanju artikala.");
    }
});

// API endpoint za artikle (JSON response)
app.get("/api/artikli", async(req, res) => {
    try {
        const artikli = (await db.query('SELECT * FROM artikli ORDER BY sifra')).rows;
        
        console.log('API Artikli response:', artikli.length, 'articles found');
        if (artikli.length > 0) {
            console.log('Sample article structure:', Object.keys(artikli[0]));
        }
        
        res.json(artikli);
    } catch (error) {
        console.error("Error fetching artikli:", error);
        res.status(500).json({ error: "Greška pri dohvatanju artikala." });
    }
});

// Uzmi pojedinačni artikal po šifri
app.get("/artikli/:sifra", async (req, res) => {
    const sifra = req.params.sifra;
    try {
        const result = await db.query('SELECT * FROM artikli WHERE sifra = $1', [sifra]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Artikal nije pronađen' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching artikal:", error);
        res.status(500).json({ error: "Greška pri dohvatanju artikla." });
    }
});

// Dodaj artikal
app.post("/artikli", async (req, res) => {
    const a = req.body;
    try {
        // Validacija obaveznih polja
        if (!a.sifra || !a.naziv || !a.jm) {
            return res.status(400).json({ error: "Šifra, naziv artikla i jedinica mere su obavezni." });
        }

        // Proveri da li šifra već postoji
        const existingArticle = await db.query('SELECT sifra FROM artikli WHERE sifra = $1', [a.sifra]);
        if (existingArticle.rows.length > 0) {
            return res.status(400).json({ error: "Artikal sa ovom šifrom već postoji." });
        }

        await db.query(
            `INSERT INTO artikli (sifra, naziv, jm, vrsta) 
             VALUES ($1, $2, $3, $4)`,
            [
                a.sifra,
                a.naziv,
                a.jm,
                a.vrsta || null
            ]
        );
        
        res.status(201).json({ 
            message: "Artikal je uspešno dodat.", 
            sifra: a.sifra 
        });
    } catch (error) {
        console.error("Error adding artikal:", error);
        if (error.code === '23505') { // PostgreSQL unique violation
            res.status(400).json({ error: "Artikal sa ovom šifrom već postoji." });
        } else {
            res.status(500).json({ error: "Greška pri dodavanju artikla: " + error.message });
        }
    }
});

// Izmeni artikal
app.put("/artikli/:sifra", async (req, res) => {
    const sifra = req.params.sifra;
    const a = req.body;
    try {
        // Validacija obaveznih polja
        if (!a.naziv || !a.jm) {
            return res.status(400).json({ error: "Naziv artikla i jedinica mere su obavezni." });
        }

        // Proveri da li artikal postoji
        const existingArticle = await db.query('SELECT * FROM artikli WHERE sifra = $1', [sifra]);
        if (existingArticle.rows.length === 0) {
            return res.status(404).json({ error: "Artikal nije pronađen." });
        }

        await db.query(
            `UPDATE artikli SET 
                naziv = $1,
                jm = $2,
                vrsta = $3
             WHERE sifra = $4`,
            [
                a.naziv,
                a.jm,
                a.vrsta || null,
                sifra
            ]
        );
        
        res.json({ message: "Artikal je uspešno ažuriran." });
    } catch (error) {
        console.error("Error updating artikal:", error);
        res.status(500).json({ error: "Greška pri izmeni artikla: " + error.message });
    }
});

// Obriši artikal
app.delete("/artikli/:sifra", async (req, res) => {
    const sifra = req.params.sifra;
    try {
        // Proveri da li artikal postoji
        const existingArticle = await db.query('SELECT sifra FROM artikli WHERE sifra = $1', [sifra]);
        if (existingArticle.rows.length === 0) {
            return res.status(404).json({ error: "Artikal nije pronađen." });
        }

        await db.query('DELETE FROM artikli WHERE sifra = $1', [sifra]);
        res.json({ message: "Artikal je uspešno obrisan." });
    } catch (error) {
        console.error("Error deleting artikal:", error);
        if (error.code === '23503') { // PostgreSQL foreign key violation
            res.status(400).json({ error: "Ne možete obrisati artikal koji se koristi u drugim dokumentima." });
        } else {
            res.status(500).json({ error: "Greška pri brisanju artikla." });
        }
    }
});

// Pretraži artikle po nazivu ili šifri
app.get("/api/artikli/search", async (req, res) => {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
        return res.status(400).json({ error: "Upit mora imati najmanje 2 karaktera." });
    }

    try {
        const searchResult = await db.query(
            `SELECT * FROM artikli 
             WHERE LOWER(naziv) LIKE LOWER($1) OR LOWER(sifra) LIKE LOWER($1)
             ORDER BY sifra`,
            [`%${query}%`]
        );

        res.json(searchResult.rows);
    } catch (error) {
        console.error("Error searching artikli:", error);
        res.status(500).json({ error: "Greška pri pretraživanju artikala." });
    }
});

// Artikli statistike
app.get("/api/artikli/stats", async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_items,
                COUNT(DISTINCT vrsta) as total_categories,
                COUNT(CASE WHEN vrsta IS NOT NULL THEN 1 END) as items_with_category,
                COUNT(CASE WHEN vrsta IS NULL THEN 1 END) as items_without_category
            FROM artikli
        `);

        const categoryStats = await db.query(`
            SELECT 
                vrsta as category,
                COUNT(*) as count
            FROM artikli 
            WHERE vrsta IS NOT NULL
            GROUP BY vrsta
            ORDER BY count DESC
        `);

        res.json({
            ...stats.rows[0],
            categories: categoryStats.rows
        });
    } catch (error) {
        console.error("Error fetching artikli stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika artikala." });
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

// Dodaj novi lager artikal
app.post("/lager", async (req, res) => {
    const l = req.body;
    try {
        // Validacija obaveznih polja
        if (!l.sifra || !l.naziv || !l.jm || l.cena_bez_pdv === undefined || l.cena_sa_pdv === undefined) {
            return res.status(400).json({ 
                error: "Šifra, naziv, jedinica mere i cene su obavezni." 
            });
        }

        // Proveri da li šifra već postoji
        const existingItem = await db.query('SELECT sifra FROM lager WHERE sifra = $1', [l.sifra]);
        if (existingItem.rows.length > 0) {
            return res.status(400).json({ error: "Artikal sa ovom šifrom već postoji u lageru." });
        }

        // Parsiranje numeričkih vrednosti
        const kolicina = parseFloat(l.kolicina) || 0;
        const cena_bez_pdv = parseFloat(l.cena_bez_pdv);
        const cena_sa_pdv = parseFloat(l.cena_sa_pdv);

        // Validacija cena
        if (cena_bez_pdv < 0 || cena_sa_pdv < 0) {
            return res.status(400).json({ error: "Cene ne mogu biti negativne." });
        }

        if (kolicina < 0) {
            return res.status(400).json({ error: "Količina ne može biti negativna." });
        }

        await db.query(
            `INSERT INTO lager (sifra, naziv, jm, kolicina, cena_bez_PDV, cena_sa_PDV, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
            [l.sifra, l.naziv, l.jm, kolicina, cena_bez_pdv, cena_sa_pdv]
        );

        res.status(201).json({ 
            message: "Lager artikal je uspešno dodat.", 
            sifra: l.sifra 
        });
    } catch (error) {
        console.error("Error adding lager item:", error);
        if (error.code === '23505') { // PostgreSQL unique violation
            res.status(400).json({ error: "Artikal sa ovom šifrom već postoji u lageru." });
        } else {
            res.status(500).json({ error: "Greška pri dodavanju lager artikla: " + error.message });
        }
    }
});

// Izmeni lager artikal
app.put("/lager/:id", async (req, res) => {
    const id = req.params.id;
    const l = req.body;
    try {
        // Validacija obaveznih polja
        if (!l.naziv || !l.jm || l.cena_bez_pdv === undefined || l.cena_sa_pdv === undefined) {
            return res.status(400).json({ 
                error: "Naziv, jedinica mere i cene su obavezni." 
            });
        }

        // Proveri da li artikal postoji
        const existingItem = await db.query('SELECT * FROM lager WHERE id = $1', [id]);
        if (existingItem.rows.length === 0) {
            return res.status(404).json({ error: "Lager artikal nije pronađen." });
        }

        // Parsiranje numeričkih vrednosti
        const kolicina = parseFloat(l.kolicina) || 0;
        const cena_bez_pdv = parseFloat(l.cena_bez_pdv);
        const cena_sa_pdv = parseFloat(l.cena_sa_pdv);

        // Validacija
        if (cena_bez_pdv < 0 || cena_sa_pdv < 0) {
            return res.status(400).json({ error: "Cene ne mogu biti negativne." });
        }

        if (kolicina < 0) {
            return res.status(400).json({ error: "Količina ne može biti negativna." });
        }

        await db.query(
            `UPDATE lager SET 
                naziv = $1, jm = $2, kolicina = $3, 
                cena_bez_PDV = $4, cena_sa_PDV = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [l.naziv, l.jm, kolicina, cena_bez_pdv, cena_sa_pdv, id]
        );

        res.json({ message: "Lager artikal je uspešno ažuriran." });
    } catch (error) {
        console.error("Error updating lager item:", error);
        res.status(500).json({ error: "Greška pri izmeni lager artikla: " + error.message });
    }
});

// Obrisi lager artikal
app.delete("/lager/:id", async (req, res) => {
    const id = req.params.id;
    try {
        // Proveri da li artikal postoji
        const existingItem = await db.query('SELECT id FROM lager WHERE id = $1', [id]);
        if (existingItem.rows.length === 0) {
            return res.status(404).json({ error: "Lager artikal nije pronađen." });
        }

        await db.query('DELETE FROM lager WHERE id = $1', [id]);
        res.json({ message: "Lager artikal je uspešno obrisan." });
    } catch (error) {
        console.error("Error deleting lager item:", error);
        res.status(500).json({ error: "Greška pri brisanju lager artikla." });
    }
});

// Ažuriraj količinu lager artikla (za inventar)
app.patch("/lager/:id/quantity", async (req, res) => {
    const id = req.params.id;
    const { kolicina, operation } = req.body; // operation can be 'set', 'add', 'subtract'
    
    try {
        if (kolicina === undefined || kolicina < 0) {
            return res.status(400).json({ error: "Količina mora biti pozitivna." });
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
                if (newQuantity < 0) {
                    return res.status(400).json({ error: "Količina ne može biti negativna." });
                }
                break;
            case 'set':
            default:
                newQuantity = parseFloat(kolicina);
                break;
        }

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

// Glavna ruta za prikaz stranice za pravljenje dokumenata
app.get("/pravljenjedokumenta", async (req, res) => {
    try {
        const [dokumenti, lagerArtikli, komercijalisti, partneri] = await Promise.all([
            db.query('SELECT * FROM dokumenti ORDER BY datum DESC, id DESC'),
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


// API endpoint za kreiranje novog dokumenta (univerzalni)
app.post("/api/pravljenjedokumenta", async (req, res) => {
    try {
        await db.query('BEGIN');
        
        const { 
            tipDokumenta, 
            partner, 
            komercijalist_id,
            artikli, 
            rabat, 
            ukupanIznos
        } = req.body;
        
        // Validacija osnovnih podataka
        if (!tipDokumenta || !partner || !komercijalist_id || !artikli || artikli.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ 
                error: "Tip dokumenta, partner, komercijalist i artikli su obavezni." 
            });
        }

        // Validacija da komercijalist postoji i aktivan je
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
        
        // Generiši broj dokumenta na osnovu tipa
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        let documentTypePattern;
        let documentPrefix;
        
        switch(tipDokumenta.toLowerCase()) {
            case 'ponuda':
                documentTypePattern = 'Ponuda%';
                documentPrefix = 'PON';
                break;
            case 'predracun':
                documentTypePattern = 'Predračun%';
                documentPrefix = 'PR';
                break;
            case 'otpremnica':
                documentTypePattern = 'Otpremnica%';
                documentPrefix = 'OTP';
                break;
            case 'kalkulacija':
                documentTypePattern = 'Kalkulacija%';
                documentPrefix = 'KAL';
                break;
            default:
                await db.query('ROLLBACK');
                return res.status(400).json({ error: "Nepoznat tip dokumenta." });
        }
        
        // Npr. year = 2025, month = 9
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDateObj = new Date(year, month, 1); // JS meseci su 0-based
        const endDate = endDateObj.toISOString().split("T")[0]; 

        const countResult = await db.query(
          `SELECT COUNT(*) as count 
           FROM dokumenti 
           WHERE tip_dokumenta LIKE $1
           AND datum >= $2::date
           AND datum <  $3::date`,
          [documentTypePattern, startDate, endDate]
        );

        const documentNumber = `${documentPrefix}-${String(parseInt(countResult.rows[0].count) + 1).padStart(3, '0')}-${year}${month}`;
        
        // Obradi artikle i ažuriraj lager (samo za otpremnica i kalkulacija)
        const processedArtikli = [];
        let totalKolicina = 0;
        let lagerUpdateErrors = [];

        for (const artikal of artikli) {
            // Validacija artikla iz lager-a
            const lagerResult = await db.query('SELECT * FROM lager WHERE sifra = $1', [artikal.sifra]);
            if (lagerResult.rows.length === 0) {
                lagerUpdateErrors.push(`Artikal ${artikal.sifra} nije pronađen u lageru`);
                continue;
            }
            
            const lagerArtikal = lagerResult.rows[0];
            const requestedQuantity = parseFloat(artikal.kolicina) || 0;
            
            // Za otpremnicu i kalkulaciju, oduzmi sa lagera
            if (['otpremnica', 'kalkulacija'].includes(tipDokumenta.toLowerCase())) {
                if (lagerArtikal.kolicina < requestedQuantity) {
                    lagerUpdateErrors.push(
                        `Nedovoljna količina za artikal ${artikal.sifra} - dostupno: ${lagerArtikal.kolicina}, traži se: ${requestedQuantity}`
                    );
                    continue;
                }
                
                await db.query(
                    'UPDATE lager SET kolicina = kolicina - $1 WHERE sifra = $2',
                    [requestedQuantity, artikal.sifra]
                );
            }
            
            processedArtikli.push({
                sifra: artikal.sifra,
                naziv: lagerArtikal.naziv,
                jm: lagerArtikal.jm,
                kolicina: requestedQuantity,
                cena_bez_pdv: parseFloat(lagerArtikal.cena_bez_pdv) || 0,
                cena_sa_pdv: parseFloat(lagerArtikal.cena_sa_pdv) || 0
            });
            
            totalKolicina += requestedQuantity;
        }

        // Ako ima grešaka sa lagerom, prekini transakciju
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
        
        // Kreiraj string artikala za dokumenti tabelu
        const artikliString = processedArtikli.map(item => 
            `${item.sifra} - ${item.naziv} (${item.kolicina} ${item.jm})`
        ).join(', ');
        
        // Kalkulacije za iznose
        const rabatValue = parseFloat(rabat) || 0;
        const calculatedUkupanIznos = {
    iznosBezPdv: parseFloat(req.body.ukupnoBezPdv) || 0,
    iznosSaPdv: parseFloat(req.body.ukupnoSaPdv) || 0,
    pdvIznos: parseFloat(req.body.ukupanPdv) || 0
};

        
        // Sačuvaj glavni dokument u dokumenti tabelu
        const documentResult = await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat, komercijalist_id
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
                today,
                partner,
                `${tipDokumenta} ${documentNumber}`,
                artikliString,
                totalKolicina,
                parseFloat(calculatedUkupanIznos.iznosBezPdv) || 0,
                parseFloat(calculatedUkupanIznos.iznosSaPdv) || 0,
                parseFloat(calculatedUkupanIznos.pdvIznos) || 0,
                rabatValue,
                komercijalist_id
            ]
        );

        const documentId = documentResult.rows[0].id;
        
        // Proveri da li je partner nov
        const existingPartnerCheck = await db.query(
            'SELECT COUNT(*) as count FROM dokumenti WHERE partner = $1 AND id < $2', 
            [partner, documentId]
        );
        
        const isNewPartner = parseInt(existingPartnerCheck.rows[0].count) === 0;
        
        await db.query('COMMIT');

        res.json({ 
            success: true, 
            documentNumber: documentNumber,
            documentId: documentId,
            message: `${tipDokumenta} je uspešno kreiran/a`,
            komercijalist: komercijalist.ime_prezime,
            processedItems: processedArtikli.length,
            lagerUpdated: ['otpremnica', 'kalkulacija'].includes(tipDokumenta.toLowerCase()),
            newPartner: isNewPartner
        });
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Error creating document:", error);
        res.status(500).json({ error: "Greška pri kreiranju dokumenta: " + error.message });
    } 
});

app.get("/api/pravljenjedokumenta/dokumenti", async (req, res) => {
    try {
        const { 
            tip_dokumenta, 
            partner, 
            komercijalist,
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


// =============================================================================
// OSTALE POSTOJEĆE RUTE (zadržane zbog kompatibilnosti)
// =============================================================================

app.get('/prometrobe', async (req, res) => {
    try {
        // Get all promet robe data
        const prometData = await db.query(`
            SELECT 
                id,
                TO_CHAR(datum, 'YYYY-MM-DD') as datum,
                gr,
                sifra,
                ean,
                naziv,
                magacin,
                partner,
                jm,
                kol_ulaz,
                kol_izlaz
            FROM promet_robe 
            ORDER BY datum DESC
        `);

        // Get unique values for filter dropdowns
        const magacini = await db.query('SELECT DISTINCT magacin FROM promet_robe WHERE magacin IS NOT NULL ORDER BY magacin');
        const partneri = await db.query('SELECT DISTINCT partner FROM promet_robe WHERE partner IS NOT NULL ORDER BY partner');
        const grupe = await db.query('SELECT DISTINCT gr FROM promet_robe WHERE gr IS NOT NULL ORDER BY gr');

        res.render('prometrobe.ejs', {
            prometData: prometData.rows,
            magacini: magacini.rows,
            partneri: partneri.rows,
            grupe: grupe.rows
        });
    } catch (err) {
        console.error('Error fetching promet robe data:', err);
        res.status(500).send('Server error');
    }
});

// Route to add new promet robe entry
app.post('/prometrobe/add', async (req, res) => {
    try {
        const {
            datum,
            gr,
            sifra,
            ean,
            naziv,
            magacin,
            partner,
            jm,
            kol_ulaz,
            kol_izlaz
        } = req.body;

        await db.query(`
            INSERT INTO promet_robe (datum, gr, sifra, ean, naziv, magacin, partner, jm, kol_ulaz, kol_izlaz)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [datum, gr, sifra, ean || null, naziv, magacin, partner, jm || null, kol_ulaz || null, kol_izlaz || null]);

        res.redirect('/prometrobe');
    } catch (err) {
        console.error('Error adding promet robe entry:', err);
        res.status(500).send('Server error');
    }
});

// API route for filtering data
app.get('/api/prometrobe/filter', async (req, res) => {
    try {
        const {
            dateFrom,
            dateTo,
            magacin,
            partner,
            grupa
        } = req.query;

        let query = `
            SELECT 
                id,
                TO_CHAR(datum, 'YYYY-MM-DD') as datum,
                gr,
                sifra,
                ean,
                naziv,
                magacin,
                partner,
                jm,
                kol_ulaz,
                kol_izlaz
            FROM promet_robe 
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;

        if (dateFrom) {
            paramCount++;
            query += ` AND datum >= $${paramCount}`;
            params.push(dateFrom);
        }

        if (dateTo) {
            paramCount++;
            query += ` AND datum <= $${paramCount}`;
            params.push(dateTo);
        }

        if (magacin) {
            paramCount++;
            query += ` AND magacin = $${paramCount}`;
            params.push(magacin);
        }

        if (partner) {
            paramCount++;
            query += ` AND partner = $${paramCount}`;
            params.push(partner);
        }

        if (grupa) {
            paramCount++;
            query += ` AND gr = $${paramCount}`;
            params.push(grupa);
        }

        query += ' ORDER BY datum DESC';

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error filtering promet robe data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DOKUMENTI ROUTES - UNCHANGED (works with any structure)

// Prikaz svih dokumenata sa podacima za filtere
app.get("/dokumenti", async (req, res) => {
    try {
        // Uzmi sve dokumente
        const dokumenti = (await db.query('SELECT * FROM dokumenti ORDER BY datum DESC, id')).rows;
        
        // Uzmi jedinstvene partnere za filter
        const partneri = (await db.query('SELECT DISTINCT partner FROM dokumenti ORDER BY partner')).rows.map(row => row.partner);
        
        // Uzmi jedinstvene tipove dokumenata za filter
        const tipovi = (await db.query('SELECT DISTINCT tip_dokumenta FROM dokumenti ORDER BY tip_dokumenta')).rows.map(row => row.tip_dokumenta);
        
        // Uzmi jedinstvene nazive artikala za filter
        const artikli = (await db.query('SELECT DISTINCT naziv_artikla FROM dokumenti ORDER BY naziv_artikla')).rows.map(row => row.naziv_artikla);
        
        res.render("dokumenti.ejs", { 
            dokumenti, 
            partneri, 
            tipovi, 
            artikli 
        });
    } catch (error) {
        console.error("Error fetching dokumenti:", error);
        res.status(500).send("Greška pri dohvatanju dokumenata.");
    }
});

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

// Obriši dokument
app.delete("/dokumenti/:id", async (req, res) => {
    const id = req.params.id;
    try {
        await db.query('DELETE FROM dokumenti WHERE id = $1', [id]);
        res.sendStatus(200);
    } catch (error) {
        console.error("Error deleting dokument:", error);
        res.status(500).send("Greška pri brisanju dokumenta.");
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
                documentTypePattern = 'Predračun%';
                break;
            case 'kalkulacija':
                documentTypePattern = 'Kalkulacija%';
                break;
            case 'ponuda':
                documentTypePattern = 'Ponuda%';
                break;
            case 'otpremnica':
            default:
                documentTypePattern = 'Otpremnica%';
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

app.get("/magacini", (req, res) => {
    res.render("magacini.ejs");
});

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

// Get all payments as JSON (for AJAX requests)
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

// Get single payment by ID
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

// Add new payment
app.post("/api/uplate", async(req, res) => {
    try {
        const { datum, kupac, iznos, nacin, status, dokument, komercijalist, napomene } = req.body;
        
        const result = await db.query(`
            INSERT INTO "uplate" (datum, kupac, iznos, nacin, status, dokument, komercijalist, napomene) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
            RETURNING *
        `, [datum, kupac, iznos, nacin, status || 'primljena', dokument, komercijalist, napomene]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Error adding uplata:", error);
        res.status(500).json({ error: "Greška pri dodavanju uplate." });
    }
});

// Update payment
app.put("/api/uplate/:id", async(req, res) => {
    try {
        const { id } = req.params;
        const { datum, kupac, iznos, nacin, status, dokument, komercijalist, napomene } = req.body;
        
        const result = await db.query(`
            UPDATE "uplate" 
            SET datum = $1, kupac = $2, iznos = $3, nacin = $4, status = $5, 
                dokument = $6, komercijalist = $7, napomene = $8
            WHERE id = $9 
            RETURNING *
        `, [datum, kupac, iznos, nacin, status, dokument, komercijalist, napomene, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Uplata nije pronađena." });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error updating uplata:", error);
        res.status(500).json({ error: "Greška pri ažuriranju uplate." });
    }
});

// Delete payment
app.delete("/api/uplate/:id", async(req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query('DELETE FROM "uplate" WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Uplata nije pronađena." });
        }
        
        res.json({ message: "Uplata je uspješno obrisana.", uplata: result.rows[0] });
    } catch (error) {
        console.error("Error deleting uplata:", error);
        res.status(500).json({ error: "Greška pri brisanju uplate." });
    }
});

// Get payment statistics
app.get("/api/uplate/stats/summary", async(req, res) => {
    try {
        const { from, to } = req.query;
        
        let dateFilter = '';
        let params = [];
        
        if (from && to) {
            dateFilter = 'WHERE datum >= $1 AND datum <= $2';
            params = [from, to + ' 23:59:59'];
        } else if (from) {
            dateFilter = 'WHERE datum >= $1';
            params = [from];
        } else if (to) {
            dateFilter = 'WHERE datum <= $1';
            params = [to + ' 23:59:59'];
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
            totalPayments: parseFloat(stats.total_amount),
            paymentCount: parseInt(stats.total_count),
            avgPayment: parseFloat(stats.avg_payment),
            pendingPayments: parseInt(stats.pending_count),
            successfulAmount: parseFloat(stats.successful_amount),
            failedAmount: parseFloat(stats.failed_amount)
        });
    } catch (error) {
        console.error("Error fetching payment stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika." });
    }
});
// Helper funkcije za normalizaciju
function normalizePrioritet(val) {
    const map = {
        'nizak': 'Nizak',
        'srednji': 'Srednji',
        'visok': 'Visok'
    };
    if (!val) return 'Srednji'; // default
    const lower = String(val).trim().toLowerCase();
    return map[lower] || 'Srednji';
}

function normalizeGarancija(val) {
    const map = {
        'u-garanciji': 'U garanciji',
        'u garanciji': 'U garanciji',
        'van-garancije': 'Nije u garanciji',
        'nije u garanciji': 'Nije u garanciji'
    };
    if (!val) return 'Nije u garanciji'; // default
    const lower = String(val).trim().toLowerCase();
    return map[lower] || 'Nije u garanciji';
}

// GET - Lista svih servisa
app.get("/servis", async (req, res) => {
    try {
        const servisi = (await db.query(
            `SELECT 
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
            ORDER BY datum_kreiranja DESC`
        )).rows;
        
        res.render("servis.ejs", { 
            servisi: servisi,
            title: 'Servis'
        });
    } catch (error) {
        console.error("Error fetching servisi:", error);
        res.status(500).send("Greška pri dohvatanju servisa.");
    }
});

// POST - Create new service
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
        
        // Normalizacija
        const prioritetNorm = normalizePrioritet(prioritet);
        const statusGarancijeNorm = normalizeGarancija(status_garancije);

        // Get next service number
        const maxResult = await db.query(
            'SELECT COALESCE(MAX(CAST(broj_servisa AS INTEGER)), 0) as max_broj FROM servisi'
        );
        const nextNumber = String(maxResult.rows[0].max_broj + 1).padStart(3, '0');
        
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
            ime_kupca,
            telefon,
            email || null,
            proizvod_model,
            serijski_broj,
            statusGarancijeNorm,
            opis_kvara,
            tehnicar,
            prioritetNorm,
            parseFloat(procenjena_cena) || 0,
            napomene || null
        ]);
        
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

// PUT - Update service
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

        // Normalizacija
        const prioritetNorm = normalizePrioritet(prioritet);
        const statusGarancijeNorm = normalizeGarancija(status_garancije);
        
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
            ime_kupca,
            telefon,
            email || null,
            proizvod_model,
            serijski_broj,
            statusGarancijeNorm,
            opis_kvara,
            tehnicar,
            prioritetNorm,
            parseFloat(procenjena_cena) || 0,
            napomene || null,
            serviceId
        ]);
        
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
        
        let updateQuery = 'UPDATE servisi SET status = $1';
        let params = [status];
        let paramIndex = 2;
        
        if (napomena) {
            updateQuery += `, napomene = CONCAT(COALESCE(napomene, ''), $${paramIndex})`;
            params.push(`\n---\nStatus promena (${new Date().toLocaleDateString('sr-RS')}): ${napomena}`);
            paramIndex++;
        }
        
        if (finalna_cena && (status === 'gotov' || status === 'isporucen')) {
            updateQuery += `, procenjena_cena = $${paramIndex}`;
            params.push(parseFloat(finalna_cena));
            paramIndex++;
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
            'SELECT id FROM servisi WHERE id = $1',
            [serviceId]
        );
        
        if (serviceCheck.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Servis nije pronađen.' 
            });
        }
        
        // Delete the service
        await db.query('DELETE FROM servisi WHERE id = $1', [serviceId]);
        
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
            'SELECT * FROM servisi WHERE id = $1',
            [serviceId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Servis nije pronađen.' 
            });
        }
        
        res.json({ 
            success: true, 
            service: result.rows[0] 
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

// GET - Search and filter services
app.get("/servis/search", async (req, res) => {
    try {
        const { search = '', status = '', tehnicar = '' } = req.query;
        
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
            query += ` AND (ime_kupca ILIKE $${paramIndex} OR proizvod_model ILIKE $${paramIndex} OR opis_kvara ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        if (status) {
            query += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        if (tehnicar) {
            query += ` AND tehnicar = $${paramIndex}`;
            params.push(tehnicar);
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


app.listen(port, () =>{
    console.log("Server spreman na portu " + port);
});