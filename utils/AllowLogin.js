const supabase = require("../supabaseClient");
const db = require("../db");

async function canUserLogin(email) {
    // 1️⃣ Fetch the user from Supabase
    const { data: userData, error: userErr } = await supabase
        .from("activeusers")
        .select("email, devices")
        .eq("email", email)
        .single();

    if (userErr) throw new Error("User fetch error: " + userErr.message);
    if (!userData) throw new Error("User not found");

    const allowedDevices = userData.devices;

    // 2️⃣ Count active sessions from SQLite
    const activeSessions = await new Promise((resolve, reject) => {
        db.get(
            `SELECT COUNT(*) AS sessionCount
       FROM UserSessions
       WHERE user_email = ? AND active = 1`,
            [email],
            (err, row) => {
                if (err) return reject(err);
                resolve(row.sessionCount);
            }
        );
    });

    // 3️⃣ Deny login if active sessions exceed allowed devices
    if (activeSessions >= allowedDevices) {
        return { allowed: false, message: "Maximum device limit reached!" };
    }

    return { allowed: true };
}

module.exports = { canUserLogin };