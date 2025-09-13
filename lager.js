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
});
db.connect();

// Ruta za čišćenje kolone kolicina red po red
app.get("/clean-kolicina", async (req, res) => {
    try {
        const rows = (await db.query("SELECT id, kolicina FROM lager ORDER BY id")).rows;

        for (const row of rows) {
            const cleaned = row.kolicina.replace(/,/g, "").replace(".00", "");
            await db.query("UPDATE lager SET kolicina = $1 WHERE id = $2", [cleaned, row.id]);

            console.log(`✔ Red ID=${row.id} očišćen (${row.kolicina} → ${cleaned})`);
        }

        console.log(`🎉 Gotovo! Ukupno očišćeno redova: ${rows.length}`);
        res.send(`🎉 Gotovo! Ukupno očišćeno redova: ${rows.length}`);
    } catch (error) {
        console.error("❌ Greška pri čišćenju kolone kolicina:", error);
        res.status(500).send("❌ Greška pri čišćenju kolone kolicina.");
    }
});

app.listen(port, () => {
    console.log(`Server radi na http://localhost:${port}`);
});
