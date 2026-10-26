#!/usr/bin/env node
/**
 * Build students.js from one or more CSV files.
 *
 * Source CSV format: Roll No, Name, Div, Link
 * - Marks are never read or written.
 * - Add more division files to SOURCES and rerun:
 *     node scripts/generate-students.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'students.js');

/** Add additional CSV files here when the other divisions send their sheets. */
const SOURCES = [
  'ewaste_students_all.csv',
];

/**
 * Source-data corrections. These are the only values changed from the CSV.
 * 24102C052 is one digit short in the source; pad it to the standard
 * 10-character roll format used by every other student.
 */
const ROLL_FIXES = new Map([
  ['24102C052', '24102C0052'],
]);

/** Missing spaces in the source sheet. */
const NAME_FIXES = new Map([
  ['adityavibhute', 'Aditya Vibhute'],
  ['omshelke', 'Om Shelke'],
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  const source = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(headers, candidates, label) {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index !== -1) return index;
  }
  throw new Error(`Could not find the "${label}" column in the CSV header.`);
}

function cleanName(value) {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  const fixed = NAME_FIXES.get(collapsed.toLowerCase()) ?? collapsed;

  return fixed
    .toLowerCase()
    .replace(/(^|[\s'’.-])(\p{L})/gu, (_, boundary, letter) => boundary + letter.toUpperCase());
}

function cleanRoll(value) {
  const raw = value.trim().toUpperCase();
  const fixed = ROLL_FIXES.get(raw) ?? raw;

  // A few sheets lose a leading zero in the numeric suffix. Put it back.
  if (/^\d{5}[A-Z]\d{3}$/.test(fixed)) {
    return `${fixed.slice(0, -3)}0${fixed.slice(-3)}`;
  }

  return fixed;
}

function readStudents() {
  const students = [];
  const seenRolls = new Map();

  for (const file of SOURCES) {
    const path = resolve(ROOT, file);
    const rows = parseCsv(readFileSync(path, 'utf8'));

    const headerRowIndex = rows.findIndex((row) => {
      const keys = row.map(normalizeKey);
      return keys.includes('rollno') && keys.includes('name');
    });

    if (headerRowIndex === -1) {
      throw new Error(`No usable header row found in ${file}.`);
    }

    const headers = rows[headerRowIndex].map(normalizeKey);
    const rollIndex = findColumn(headers, ['rollno', 'rollnumber'], 'Roll No');
    const nameIndex = findColumn(headers, ['name', 'studentname'], 'Name');
    const divisionIndex = findColumn(headers, ['div', 'division'], 'Div');
    const linkIndex = findColumn(headers, ['link', 'url', 'dashboardlink'], 'Link');

    for (const row of rows.slice(headerRowIndex + 1)) {
      if (!row.some((cell) => cell.trim() !== '')) continue;

      const roll = cleanRoll(row[rollIndex] ?? '');
      const name = cleanName(row[nameIndex] ?? '');
      const division = (row[divisionIndex] ?? '').trim().toUpperCase();
      const link = (row[linkIndex] ?? '').trim();

      if (!roll || !name) {
        throw new Error(`Missing roll number or name in ${file}: ${JSON.stringify(row)}`);
      }
      if (!['A', 'B', 'C'].includes(division)) {
        throw new Error(`Invalid division "${division}" for ${roll} (${name}) in ${file}.`);
      }
      if (link && !/^https?:\/\//i.test(link)) {
        throw new Error(`Invalid dashboard URL for ${roll} (${name}): ${link}`);
      }
      if (seenRolls.has(roll)) {
        throw new Error(`Duplicate roll number ${roll} in ${file}; first seen in ${seenRolls.get(roll)}.`);
      }

      seenRolls.set(roll, file);
      students.push({ roll, name, division, link });
    }
  }

  return students;
}

function buildDivisions(students) {
  return Object.fromEntries(students.map(({ roll, division }) => [roll, division]));
}

function escapeForJs(value) {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function render(students) {
  const divisions = buildDivisions(students);
  const divisionLines = Object.entries(divisions)
    .map(([roll, division]) => `  ${escapeForJs(roll)}: ${escapeForJs(division)},`)
    .join('\n');

  const studentLines = students
    .map((student) => {
      const roll = escapeForJs(student.roll);
      const name = escapeForJs(student.name);
      const division = escapeForJs(student.division);
      const link = escapeForJs(student.link);
      return `  { roll: ${roll}, name: ${name}, division: ${division}, link: ${link} },`;
    })
    .join('\n');

  return `/*
 * AUTO-GENERATED by scripts/generate-students.mjs.
 * Source: ${SOURCES.join(', ')}
 *
 * No marks are stored in this file — only roll number, name, division and link.
 * DIVISIONS is editable: change a roll's A/B/C value to move the student.
 * script.js reads DIVISIONS at runtime, so a division change needs no rebuild.
 */

const DIVISIONS = {
${divisionLines}
};

const STUDENTS = [
${studentLines}
];

window.DIVISIONS = DIVISIONS;
window.STUDENTS = STUDENTS;
`;
}

const students = readStudents();
writeFileSync(OUTPUT, render(students), 'utf8');

const byDivision = students.reduce((result, student) => {
  result[student.division] ??= { students: 0, live: 0 };
  result[student.division].students += 1;
  if (student.link) result[student.division].live += 1;
  return result;
}, {});
const live = students.filter((student) => student.link).length;

console.log(`Wrote ${OUTPUT}`);
console.log(`${students.length} students · ${live} links · ${Math.round((live / students.length) * 100)}% submitted`);
for (const division of ['A', 'B', 'C']) {
  const counts = byDivision[division] ?? { students: 0, live: 0 };
  console.log(`  CMPN ${division}: ${counts.students} students, ${counts.live} live`);
}
