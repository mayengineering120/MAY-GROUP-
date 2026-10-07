// Create (or reset the password of) an administrator from the command line.
// Usage: npm run create-admin -- "Full Name" email@example.com "a-strong-password"
const { db } = require('../src/db');
const auth = require('../src/auth');

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error('Usage: npm run create-admin -- "Full Name" email@example.com "password"');
  process.exit(1);
}
const pwErr = auth.validatePassword(password);
if (pwErr) {
  console.error(pwErr);
  process.exit(1);
}
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?").run(
    name, auth.hashPassword(password), existing.id,
  );
  console.log(`Updated ${email}: now an active administrator with the new password.`);
} else {
  auth.createUser({ name, email, password, role: 'admin' });
  console.log(`Created administrator ${email}.`);
}
