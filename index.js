import express from 'express';
import bodyParser from 'body-parser';
import pg from "pg";
import dotenv from 'dotenv';

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
            `INSERT INTO lager (sifra, naziv, jm, kolicina, cena_bez_pdv, cena_sa_pdv, updated_at)
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
                cena_bez_pdv = $4, cena_sa_pdv = $5, updated_at = CURRENT_TIMESTAMP
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
                ROUND(AVG(cena_bez_pdv), 2) as avg_price_bez_pdv,
                ROUND(SUM(kolicina * cena_bez_pdv), 2) as total_value_bez_pdv,
                ROUND(SUM(kolicina * cena_sa_pdv), 2) as total_value_sa_pdv
            FROM lager
        `);

        res.json(stats.rows[0]);
    } catch (error) {
        console.error("Error fetching lager stats:", error);
        res.status(500).json({ error: "Greška pri dohvatanju statistika lagera." });
    }
});

// OTPREMNICA ROUTES - UPDATED (simplified to work with new artikli structure)
app.get("/otpremnica", async (req, res) => {
    try {
        const artikli = (await db.query('SELECT * FROM artikli ORDER BY "Šifra"')).rows;
        res.render("otpremnica.ejs", { artikli });
    } catch (error) {
        console.error("Error fetching artikli for otpremnica:", error);
        res.status(500).send("Greška pri dohvatanju artikala.");
    }
});

// API endpoint za kreiranje otpremnice
app.post("/api/otpremnica", async (req, res) => {
    try {
        const { partner, artikli, napomene } = req.body;
        
        // Validacija podataka
        if (!partner || !artikli || artikli.length === 0) {
            return res.status(400).json({ error: "Partner i artikli su obavezni." });
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Generiši broj otpremnice
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        const countResult = await db.query(
            `SELECT COUNT(*) as count FROM dokumenti 
             WHERE tip_dokumenta LIKE 'Otpremnica%' 
             AND datum >= $1 AND datum <= $2`,
            [`${year}-${month}-01`, `${year}-${month}-31`]
        );
        
        const otpremnicaNumber = `OTP-${String(parseInt(countResult.rows[0].count) + 1).padStart(3, '0')}-${year}${month}`;
        
        // Kreiraj artikle string
        const artikliString = artikli.map(item => 
            `${item.sifra} - ${item.naziv} (${item.quantity} ${item.jm})`
        ).join(', ');
        
        // Sačuvaj dokument
        await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                today,
                partner,
                `Otpremnica ${otpremnicaNumber}`,
                artikliString,
                artikli.reduce((sum, item) => sum + item.quantity, 0),
                0, // No prices in otpremnica
                0,
                0,
                0
            ]
        );
        
        res.json({ 
            success: true, 
            otpremnicaNumber: otpremnicaNumber,
            message: "Otpremnica je uspešno kreirana" 
        });
        
    } catch (error) {
        console.error("Error creating otpremnica:", error);
        res.status(500).json({ error: "Greška pri kreiranju otpremnice: " + error.message });
    }
});

// PREDRAČUN ROUTES - UPDATED (simplified for new struktura)
app.get("/predracun", async (req, res) => {
    try {
        const artikli = (await db.query('SELECT * FROM artikli ORDER BY "sifra"')).rows;
        res.render("predracun.ejs", { artikli });
    } catch (error) {
        console.error("Error fetching artikli for predracun:", error);
        res.status(500).send("Greška pri dohvatanju artikala.");
    }
});

// API endpoint za kreiranje predračuna (simplified - no complex calculations)
app.post("/api/predracun", async (req, res) => {
    try {
        const { partner, artikli, rabat, ukupanIznos } = req.body;
        
        // Validacija podataka
        if (!partner || !artikli || artikli.length === 0) {
            return res.status(400).json({ error: "Partner i artikli su obavezni." });
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Generiši broj predračuna
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        const countResult = await db.query(
            `SELECT COUNT(*) as count FROM dokumenti 
             WHERE tip_dokumenta LIKE 'Predračun%' 
             AND datum >= $1 AND datum <= $2`,
            [`${year}-${month}-01`, `${year}-${month}-31`]
        );
        
        const predracunNumber = `PR-${String(parseInt(countResult.rows[0].count) + 1).padStart(3, '0')}-${year}${month}`;
        
        // Kreiraj artikle string
        const artikliString = artikli.map(item => 
            `${item.sifra} - ${item.naziv} (${item.quantity} ${item.jm})`
        ).join(', ');
        
        // Sačuvaj dokument
        await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                today,
                partner,
                `Predračun ${predracunNumber}`,
                artikliString,
                artikli.reduce((sum, item) => sum + item.quantity, 0),
                ukupanIznos?.iznosBezPdv || 0,
                ukupanIznos?.iznosSaPdv || 0,
                ukupanIznos?.pdvIznos || 0,
                rabat || 0
            ]
        );
        
        res.json({ 
            success: true, 
            predracunNumber: predracunNumber,
            message: "Predračun je uspešno kreiran" 
        });
        
    } catch (error) {
        console.error("Error creating predracun:", error);
        res.status(500).json({ error: "Greška pri kreiranju predračuna: " + error.message });
    }
});

// API endpoint za pregled predračuna
app.get("/api/predracuni", async (req, res) => {
    try {
        const { partner, datum_od, datum_do } = req.query;
        
        let query = `SELECT * FROM dokumenti WHERE tip_dokumenta LIKE 'Predračun%'`;
        const params = [];
        let paramCount = 0;
        
        if (partner) {
            paramCount++;
            query += ` AND partner = ${paramCount}`;
            params.push(partner);
        }
        
        if (datum_od) {
            paramCount++;
            query += ` AND datum >= ${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND datum <= ${paramCount}`;
            params.push(datum_do);
        }
        
        query += ' ORDER BY datum DESC, id DESC';
        
        const predracuni = (await db.query(query, params)).rows;
        res.json(predracuni);
    } catch (error) {
        console.error("Error fetching predracuni:", error);
        res.status(500).json({ error: "Greška pri dohvatanju predračuna." });
    }
});

// KALKULACIJA ROUTES - UPDATED (simplified)
app.get("/kalkulacija", async (req, res) => {
    try {
        const artikli = (await db.query('SELECT * FROM artikli ORDER BY "Šifra"')).rows;
        res.render("kalkulacija.ejs", { artikli });
    } catch (error) {
        console.error("Error fetching artikli for kalkulacija:", error);
        res.status(500).send("Greška pri dohvatanju artikala.");
    }
});

// API endpoint za kreiranje kalkulacije
app.post("/api/kalkulacija", async (req, res) => {
    try {
        const { partner, artikli, rabat, ukupanIznos } = req.body;
        
        // Validacija podataka
        if (!partner || !artikli || artikli.length === 0) {
            return res.status(400).json({ error: "Partner i artikli su obavezni." });
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Generiši broj kalkulacije
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        const countResult = await db.query(
            `SELECT COUNT(*) as count FROM dokumenti 
             WHERE tip_dokumenta LIKE 'Kalkulacija%' 
             AND datum >= $1 AND datum <= $2`,
            [`${year}-${month}-01`, `${year}-${month}-31`]
        );
        
        const kalkulacijaNumber = `KAL-${String(parseInt(countResult.rows[0].count) + 1).padStart(3, '0')}-${year}${month}`;
        
        // Kreiraj artikle string
        const artikliString = artikli.map(item => 
            `${item.sifra} - ${item.naziv} (${item.quantity} ${item.jm})`
        ).join(', ');
        
        // Sačuvaj dokument
        await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                today,
                partner,
                `Kalkulacija ${kalkulacijaNumber}`,
                artikliString,
                artikli.reduce((sum, item) => sum + item.quantity, 0),
                ukupanIznos?.iznosBezPdv || 0,
                ukupanIznos?.iznosSaPdv || 0,
                ukupanIznos?.pdvIznos || 0,
                rabat || 0
            ]
        );
        
        res.json({ 
            success: true, 
            kalkulacijaNumber: kalkulacijaNumber,
            message: "Kalkulacija je uspešno kreirana" 
        });
        
    } catch (error) {
        console.error("Error creating kalkulacija:", error);
        res.status(500).json({ error: "Greška pri kreiranju kalkulacije: " + error.message });
    }
});

// API endpoint za pregled kalkulacija
app.get("/api/kalkulacije", async (req, res) => {
    try {
        const { partner, datum_od, datum_do } = req.query;
        
        let query = `SELECT * FROM dokumenti WHERE tip_dokumenta LIKE 'Kalkulacija%'`;
        const params = [];
        let paramCount = 0;
        
        if (partner) {
            paramCount++;
            query += ` AND partner = ${paramCount}`;
            params.push(partner);
        }
        
        if (datum_od) {
            paramCount++;
            query += ` AND datum >= ${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND datum <= ${paramCount}`;
            params.push(datum_do);
        }
        
        query += ' ORDER BY datum DESC, id DESC';
        
        const kalkulacije = (await db.query(query, params)).rows;
        res.json(kalkulacije);
    } catch (error) {
        console.error("Error fetching kalkulacije:", error);
        res.status(500).json({ error: "Greška pri dohvatanju kalkulacija." });
    }
});

app.get("/prometrobe", async (req, res) => {
    res.render("prometrobe.ejs");
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
                datum, partner, tip_dokumenta, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                d.datum,
                d.partner,
                d.tip_dokumenta,
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
            query += ` AND datum >= ${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND datum <= ${paramCount}`;
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

// KOMERCIJALISTI ROUTES
app.get("/komercijalisti", async (req, res) => {
    try {
        const komercijalisti = (await db.query(
            'SELECT * FROM komercijalisti ORDER BY ime_prezime'
        )).rows;
        res.render("komercijalisti.ejs", { komercijalisti });
    } catch (error) {
        console.error("Error fetching komercijalisti:", error);
        res.status(500).send("Greška pri dohvatanju komercijalista.");
    }
});

// API endpoint za komercijaliste (JSON response)
app.get("/api/komercijalisti", async(req, res) => {
    try {
        const komercijalisti = (await db.query(
            'SELECT * FROM komercijalisti ORDER BY ime_prezime'
        )).rows;
        
        console.log('API Komercijalisti response:', komercijalisti.length, 'komercijalisti found');
        if (komercijalisti.length > 0) {
            console.log('Sample komercijalist structure:', Object.keys(komercijalisti[0]));
        }
        
        res.json(komercijalisti);
    } catch (error) {
        console.error("Error fetching komercijalisti:", error);
        res.status(500).json({ error: "Greška pri dohvatanju komercijalista." });
    }
});

// Uzmi pojedinačnog komercijalista po ID-u
app.get("/komercijalisti/:id", async(req, res) => {
    const id = req.params.id;
    try {
        const result = await db.query('SELECT * FROM komercijalisti WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Komercijalist nije pronađen' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching komercijalist:", error);
        res.status(500).json({ error: "Greška pri dohvatanju komercijalista." });
    }
});

// Dodaj novog komercijalista
app.post("/komercijalisti", async (req, res) => {
    const k = req.body;
    try {
        // Validacija obaveznih polja
        if (!k.ime_prezime) {
            return res.status(400).json({ error: "Ime i prezime je obavezno." });
        }

        // Parsiranje numeričkih vrednosti
        const broj_kupaca = parseInt(k.broj_kupaca) || 0;
        const mjesecna_prodaja = parseFloat(k.mjesecna_prodaja) || 0;
        const performanse = parseFloat(k.performanse) || 0;

        // Validacija performansi (trebaju biti između 0 i 100)
        if (performanse < 0 || performanse > 100) {
            return res.status(400).json({ error: "Performanse moraju biti između 0 i 100%." });
        }

        // Validacija statusa
        const validStatuses = ['aktivan', 'neaktivan', 'pauza'];
        const status = k.status || 'aktivan';
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: "Status mora biti 'aktivan', 'neaktivan' ili 'pauza'." });
        }

        await db.query(
            `INSERT INTO komercijalisti (ime_prezime, broj_kupaca, mjesecna_prodaja, performanse, status)
            VALUES ($1, $2, $3, $4, $5)`,
            [k.ime_prezime, broj_kupaca, mjesecna_prodaja, performanse, status]
        );

        res.status(201).json({ 
            message: "Komercijalist je uspešno dodat.",
            ime_prezime: k.ime_prezime
        });
    } catch (error) {
        console.error("Error adding komercijalist:", error);
        res.status(500).json({ error: "Greška pri dodavanju komercijalista: " + error.message });
    }
});

// Izmeni komercijalista
app.put("/komercijalisti/:id", async (req, res) => {
    const id = req.params.id;
    const k = req.body;
    try {
        console.log(`Updating komercijalist ${id} with data:`, k);

        // Validacija obaveznih polja
        if (!k.ime_prezime) {
            return res.status(400).json({ error: "Ime i prezime je obavezno." });
        }

        // Proveri da li komercijalist postoji
        const existingKomercijalist = await db.query('SELECT * FROM komercijalisti WHERE id = $1', [id]);
        if (existingKomercijalist.rows.length === 0) {
            return res.status(404).json({ error: "Komercijalist nije pronađen." });
        }

        const existing = existingKomercijalist.rows[0];

        // Parsiranje numeričkih vrednosti sa fallback na postojeće vrednosti
        const broj_kupaca = parseInt(k.broj_kupaca) || existing.broj_kupaca || 0;
        const mjesecna_prodaja = parseFloat(k.mjesecna_prodaja) || existing.mjesecna_prodaja || 0;
        const performanse = parseFloat(k.performanse) !== undefined ? parseFloat(k.performanse) : existing.performanse || 0;

        // Validacija performansi
        if (performanse < 0 || performanse > 100) {
            return res.status(400).json({ error: "Performanse moraju biti između 0 i 100%." });
        }

        // Validacija statusa
        const validStatuses = ['aktivan', 'neaktivan', 'pauza'];
        const status = k.status || existing.status || 'aktivan';
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: "Status mora biti 'aktivan', 'neaktivan' ili 'pauza'." });
        }

        await db.query(
            `UPDATE komercijalisti SET 
                ime_prezime = $1,
                broj_kupaca = $2,
                mjesecna_prodaja = $3,
                performanse = $4,
                status = $5
             WHERE id = $6`,
            [k.ime_prezime, broj_kupaca, mjesecna_prodaja, performanse, status, id]
        );

        console.log(`Komercijalist ${id} successfully updated`);
        
        res.json({ 
            message: "Komercijalist je uspešno ažuriran.",
            id: id
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
        const existingKomercijalist = await db.query('SELECT id FROM komercijalisti WHERE id = $1', [id]);
        if (existingKomercijalist.rows.length === 0) {
            return res.status(404).json({ error: "Komercijalist nije pronađen." });
        }

        await db.query('DELETE FROM komercijalisti WHERE id = $1', [id]);
        res.json({ message: "Komercijalist je uspešno obrisan." });
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
    const { query } = req.query;
    
    if (!query || query.length < 2) {
        return res.status(400).json({ error: "Upit mora imati najmanje 2 karaktera." });
    }

    try {
        const searchResult = await db.query(
            `SELECT * FROM komercijalisti 
             WHERE LOWER(ime_prezime) LIKE LOWER($1)
             ORDER BY ime_prezime`,
            [`%${query}%`]
        );

        res.json(searchResult.rows);
    } catch (error) {
        console.error("Error searching komercijalisti:", error);
        res.status(500).json({ error: "Greška pri pretraživanju komercijalista." });
    }
});

// Komercijalisti statistike
app.get("/api/komercijalisti/stats", async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_komercijalisti,
                COUNT(CASE WHEN status = 'aktivan' THEN 1 END) as aktivni,
                COUNT(CASE WHEN status = 'neaktivan' THEN 1 END) as neaktivni,
                COUNT(CASE WHEN status = 'pauza' THEN 1 END) as na_pauzi,
                ROUND(AVG(performanse), 2) as avg_performanse,
                ROUND(SUM(mjesecna_prodaja), 2) as total_mjesecna_prodaja,
                SUM(broj_kupaca) as total_kupaca,
                ROUND(AVG(broj_kupaca), 2) as avg_kupaca_po_komercijalisti
            FROM komercijalisti
        `);

        const topPerformers = await db.query(`
            SELECT ime_prezime, performanse, mjesecna_prodaja, broj_kupaca, status
            FROM komercijalisti 
            WHERE status = 'aktivan'
            ORDER BY performanse DESC 
            LIMIT 5
        `);

        res.json({
            ...stats.rows[0],
            top_performers: topPerformers.rows
        });
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
        const existingKomercijalist = await db.query('SELECT id FROM komercijalisti WHERE id = $1', [id]);
        if (existingKomercijalist.rows.length === 0) {
            return res.status(404).json({ error: "Komercijalist nije pronađen." });
        }

        // Ažuriraj samo status
        await db.query('UPDATE komercijalisti SET status = $1 WHERE id = $2', [status, id]);
        
        console.log(`Successfully updated status for komercijalist ${id} to ${status}`);
        
        res.json({ 
            message: "Status komercijalista je uspešno ažuriran.",
            id: id,
            newStatus: status
        });
    } catch (error) {
        console.error("Error updating komercijalist status:", error);
        res.status(500).json({ error: "Greška pri ažuriranju statusa komercijalista: " + error.message });
    }
});

app.get("/uplate", (req, res) => {
    res.render("uplate.ejs");
});

// PONUDA ROUTES - UPDATED (simplified)
app.get("/ponuda", async (req, res) => {
    try {
        const artikli = (await db.query('SELECT * FROM artikli ORDER BY "Šifra"')).rows;
        res.render("ponuda.ejs", { artikli });
    } catch (error) {
        console.error("Error fetching artikli for ponuda:", error);
        res.status(500).send("Greška pri dohvatanju artikala.");
    }
});

// API endpoint za kreiranje ponude
app.post("/api/ponuda", async (req, res) => {
    try {
        const { partner, artikli, rabat, ukupanIznos } = req.body;
        
        // Validacija podataka
        if (!partner || !artikli || artikli.length === 0) {
            return res.status(400).json({ error: "Partner i artikli su obavezni." });
        }

        const today = new Date().toISOString().split('T')[0];
        
        // Generiši broj ponude
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        const countResult = await db.query(
            `SELECT COUNT(*) as count FROM dokumenti 
             WHERE tip_dokumenta LIKE 'Ponuda%' 
             AND datum >= $1 AND datum <= $2`,
            [`${year}-${month}-01`, `${year}-${month}-31`]
        );
        
        const ponudaNumber = `${String(parseInt(countResult.rows[0].count) + 1).padStart(3, '0')}-${year}${month}`;
        
        // Kreiraj artikle string
        const artikliString = artikli.map(item => 
            `${item.sifra} - ${item.naziv} (${item.quantity} ${item.jm})`
        ).join(', ');
        
        // Sačuvaj dokument
        await db.query(
            `INSERT INTO dokumenti (
                datum, partner, tip_dokumenta, naziv_artikla, 
                kolicina, iznos_bez_pdv, iznos_sa_pdv, pdv_iznos, rabat
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                today,
                partner,
                `Ponuda ${ponudaNumber}`,
                artikliString,
                artikli.reduce((sum, item) => sum + item.quantity, 0),
                ukupanIznos?.iznosBezPdv || 0,
                ukupanIznos?.iznosSaPdv || 0,
                ukupanIznos?.pdvIznos || 0,
                rabat || 0
            ]
        );
        
        res.json({ 
            success: true, 
            ponudaNumber: ponudaNumber,
            message: "Ponuda je uspešno kreirana" 
        });
        
    } catch (error) {
        console.error("Error creating ponuda:", error);
        res.status(500).json({ error: "Greška pri kreiranju ponude: " + error.message });
    }
});

// API endpoint za pregled ponuda
app.get("/api/ponude", async (req, res) => {
    try {
        const { partner, datum_od, datum_do } = req.query;
        
        let query = `SELECT * FROM dokumenti WHERE tip_dokumenta LIKE 'Ponuda%'`;
        const params = [];
        let paramCount = 0;
        
        if (partner) {
            paramCount++;
            query += ` AND partner = ${paramCount}`;
            params.push(partner);
        }
        
        if (datum_od) {
            paramCount++;
            query += ` AND datum >= ${paramCount}`;
            params.push(datum_od);
        }
        
        if (datum_do) {
            paramCount++;
            query += ` AND datum <= ${paramCount}`;
            params.push(datum_do);
        }
        
        query += ' ORDER BY datum DESC, id DESC';
        
        const ponude = (await db.query(query, params)).rows;
        res.json(ponude);
    } catch (error) {
        console.error("Error fetching ponude:", error);
        res.status(500).json({ error: "Greška pri dohvatanju ponuda." });
    }
});

app.get("/servis", (req, res) => {
    res.render("servis.ejs");
});

app.listen(port, () =>{
    console.log("Server spreman na portu " + port);
});