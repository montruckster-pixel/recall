/**
 * Seed a demo account so the app can be explored immediately.
 *
 *   node scripts/seed-demo.js
 *
 * Creates demo@recall.local / demo12345 with a study profile, one study set,
 * flashcards (with FSRS schedules) and a sample practice quiz. It is clearly a
 * demo account — it is never created automatically by the server.
 */
import 'dotenv/config';
import { get, run, nowIso, dayKey } from '../server/lib/db.js';
import { createUser, hashPassword } from '../server/lib/auth.js';
import { ensureCertifications } from '../server/lib/certifications.js';
import { ensureSchedule } from '../server/lib/fsrs.js';
import { id } from '../server/lib/util.js';

const EMAIL = process.env.DEMO_EMAIL || 'demo@recall.local';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo12345';

ensureCertifications();

let user = get('SELECT * FROM users WHERE email = ?', [EMAIL]);
if (user) {
  console.log(`Demo user already exists: ${EMAIL}. Resetting password.`);
  run('UPDATE users SET password_hash = ?, deleted_at = NULL WHERE id = ?', [hashPassword(PASSWORD), user.id]);
} else {
  user = createUser({ email: EMAIL, password: PASSWORD, displayName: 'Demo Student' });
}

const ts = nowIso();
run('UPDATE users SET onboarded_at = ?, updated_at = ? WHERE id = ?', [ts, ts, user.id]);

// Profile
const examDate = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
run(
  `INSERT INTO profiles (user_id, cert_slug, cert_name, exam_date, knowledge_level, daily_minutes,
     study_methods, preferred_days, daily_goal_cards, daily_goal_minutes, timezone, updated_at)
   VALUES (?, 'comptia-security-plus', 'CompTIA Security+', ?, 'intermediate', 60,
     '["flashcards","practice-questions","reading"]', '[1,2,3,4,5,6]', 50, 60, 'UTC', ?)
   ON CONFLICT(user_id) DO UPDATE SET exam_date=excluded.exam_date, updated_at=excluded.updated_at`,
  [user.id, examDate, ts],
);

// Workspace
let ws = get('SELECT * FROM workspaces WHERE user_id = ?', [user.id]);
if (!ws) {
  run('INSERT INTO workspaces (id, user_id, cert_slug, name, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    [id('ws_'), user.id, 'comptia-security-plus', 'CompTIA Security+', ts]);
  ws = get('SELECT * FROM workspaces WHERE user_id = ?', [user.id]);
}

// Study set
let set = get('SELECT * FROM study_sets WHERE user_id = ? AND title = ?', [user.id, 'Security+ Core Concepts']);
if (!set) {
  const setId = id('set_');
  run(
    `INSERT INTO study_sets (id, user_id, workspace_id, title, description, subject, topic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [setId, user.id, ws.id, 'Security+ Core Concepts',
     'Core terminology and concepts for the CompTIA Security+ exam.', 'Security', 'Core concepts', ts, ts],
  );
  set = get('SELECT * FROM study_sets WHERE id = ?', [setId]);
}

const CARDS = [
  ['What does the CIA triad stand for?', 'Confidentiality, Integrity and Availability — the three core goals of information security.', 'A lost laptop affects confidentiality; a modified database affects integrity; a DDoS attack affects availability.', 'Core concepts'],
  ['What is the difference between a vulnerability and an exploit?', 'A vulnerability is a weakness; an exploit is the technique or code that takes advantage of it.', 'An unpatched web server is a vulnerability; the request that compromises it is the exploit.', 'Core concepts'],
  ['What is multi-factor authentication (MFA)?', 'Authentication using two or more different factor categories: something you know, have, or are.', 'A password plus a one-time code from an authenticator app.', 'Identity'],
  ['Define least privilege.', 'Granting users and processes only the minimum access required to perform their function.', 'A help-desk role that can reset passwords but cannot modify firewall rules.', 'Identity'],
  ['What is the purpose of a DMZ?', 'A segmented network that exposes public services while isolating the internal network from direct access.', 'A public web server sits in the DMZ, not on the internal LAN.', 'Network security'],
  ['What is subnetting used for?', 'Dividing a network into smaller logical segments to improve performance, security and address management.', 'Splitting 192.168.1.0/24 into four /26 subnets.', 'Network security'],
  ['What is a man-in-the-middle attack?', 'An attacker secretly intercepts and possibly alters communication between two parties.', 'An attacker on the same Wi-Fi network intercepting unencrypted traffic.', 'Network security'],
  ['What is the difference between symmetric and asymmetric encryption?', 'Symmetric uses one shared key; asymmetric uses a public/private key pair.', 'AES is symmetric; RSA is asymmetric.', 'Cryptography'],
  ['What is a digital signature used for?', 'Proving authenticity and integrity of a message or file using the sender’s private key.', 'Signing a software release so users can verify it was not tampered with.', 'Cryptography'],
  ['What is the purpose of hashing in password storage?', 'Storing a one-way digest so the original password cannot be recovered from the database.', 'bcrypt or scrypt hashes with a per-user salt.', 'Cryptography'],
  ['What is incident response?', 'The structured process of preparing for, detecting, containing, eradicating and recovering from security incidents.', 'Isolating an infected host before wiping and restoring it.', 'Operations'],
  ['What is a risk register?', 'A documented list of identified risks with their likelihood, impact, owner and mitigation status.', '', 'Governance'],
];

const existingCards = get('SELECT COUNT(*) AS n FROM flashcards WHERE set_id = ?', [set.id]).n;
if (existingCards === 0) {
  for (const [front, back, example, topic] of CARDS) {
    const cid = id('card_');
    run(
      `INSERT INTO flashcards (id, user_id, set_id, front, back, example, subject, topic, difficulty, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Security', ?, 2, ?, ?)`,
      [cid, user.id, set.id, front, back, example || null, topic, ts, ts],
    );
    ensureSchedule(user.id, cid);
  }
  console.log(`Created ${CARDS.length} flashcards.`);
}

// A practice quiz with a handful of questions
let quiz = get('SELECT * FROM quizzes WHERE user_id = ? AND title = ?', [user.id, 'Security+ practice quiz']);
if (!quiz) {
  const quizId = id('qz_');
  run(
    `INSERT INTO quizzes (id, user_id, workspace_id, set_id, title, mode, question_count, difficulty, show_explanations, status, created_at)
     VALUES (?, ?, ?, ?, 'Security+ practice quiz', 'practice', 4, 'mixed', 1, 'ready', ?)`,
    [quizId, user.id, ws.id, set.id, ts],
  );
  const QS = [
    ['mcq', 'Which property of the CIA triad is most directly affected by a ransomware infection?', ['Confidentiality', 'Integrity', 'Availability', 'Non-repudiation'], 'Availability', 'Ransomware encrypts data so it cannot be used, which primarily affects availability.', 'Encrypting data does not mean the attacker read it, so availability is the best answer.', 'Core concepts'],
    ['mcq', 'Which control type is a security awareness training programme?', ['Preventive', 'Detective', 'Corrective', 'Compensating'], 'Preventive', 'Training reduces the chance of an incident occurring, making it preventive.', 'Training is often confused with detective controls, which identify incidents after they occur.', 'Governance'],
    ['mcq', 'What is the primary purpose of network segmentation?', ['Increase bandwidth', 'Limit lateral movement', 'Encrypt traffic', 'Replace firewalls'], 'Limit lateral movement', 'Segmentation restricts how far an attacker can move after compromising one host.', 'Segmentation does not encrypt traffic by itself.', 'Network security'],
    ['tf', 'Hashing is reversible, so a hashed password can be recovered with the right key.', ['True', 'False'], 'False', 'Hashing is a one-way function; it is not encryption and cannot be reversed.', 'Confusing hashing with encryption is a very common mistake.', 'Cryptography'],
  ];
  QS.forEach((q, i) => {
    const [type, prompt, options, correct, explanation, misconception, topic] = q;
    run(
      `INSERT INTO quiz_questions (id, quiz_id, user_id, type, prompt, options, correct_answer, explanation, misconception, topic, difficulty, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2', ?)`,
      [id('qq_'), quizId, user.id, type, prompt, JSON.stringify(options), correct, explanation, misconception, topic, i],
    );
  });
  console.log('Created a 4-question practice quiz.');
}

console.log('\nDemo account ready:');
console.log(`  Email:    ${EMAIL}`);
console.log(`  Password: ${PASSWORD}`);
console.log('  (This account is only created by this script — the server never seeds data.)\n');
