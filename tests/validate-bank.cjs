/*
 * ตรวจคลังข้อสอบ data/questions.json แบบไม่ต้องเปิดเบราว์เซอร์
 * รัน:  node tests/validate-bank.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

(async () => {
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8'));
  const { validateBank, scoreSession, createSession, formatPages, citation, updateWrongBook, idsToPractice } = await import(path.join(ROOT, 'js', 'exam.js'));
  const qs = bank.questions;

  check('มีข้อสอบ 60 ข้อ', qs.length === 60, `พบ ${qs.length}`);
  const byDiff = (d) => qs.filter((q) => q.difficulty === d).length;
  check('Easy 20 / Medium 20 / Hard 20', byDiff('easy') === 20 && byDiff('medium') === 20 && byDiff('hard') === 20,
    `${byDiff('easy')}/${byDiff('medium')}/${byDiff('hard')}`);

  const problems = validateBank(bank);
  check('โครงสร้างทุกข้อถูกต้อง (4 ตัวเลือก, เฉลย 1 ข้อ, หมวด, แหล่งอ้างอิง, เลขหน้าอยู่ในช่วงของไฟล์)', problems.length === 0, problems.join('; '));

  check('คำถามไม่ซ้ำกัน (ข้อความคำถาม + โค้ดประกอบ)', new Set(qs.map((q) => q.question.trim() + '|' + (q.code || ''))).size === qs.length);
  check('ข้อความคำถามไม่ซ้ำกันเลยแม้ไม่นับโค้ด', new Set(qs.map((q) => q.question.trim())).size === qs.length);
  check('ชุดตัวเลือกไม่ซ้ำกันระหว่างข้อ', new Set(qs.map((q) => [...q.choices].sort().join('|'))).size === qs.length);
  check('ทุกข้อมีคำตอบถูกเพียงข้อเดียว (answer เป็นเลขเดียว 0–3 และ choiceNotes เป็น null เฉพาะตัวถูก)',
    qs.every((q) => Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4 && q.choiceNotes.filter((n) => n === null).length === 1));
  check('คำตอบตรงกับคำอธิบาย: วลีหลัก (answerKey) อยู่ในตัวเลือกที่ถูกและในคำอธิบาย และไม่อยู่ในตัวเลือกผิด',
    qs.every((q) => q.answerKey && q.choices[q.answer].includes(q.answerKey) && q.explanation.includes(q.answerKey)
      && q.choices.every((c, i) => i === q.answer || !c.includes(q.answerKey))),
    `${qs.filter((q) => q.answerKey).length}/60 ข้อมี answerKey`);
  check('คำอธิบายไม่อ้างตัวอักษรตัวเลือก (ก/ข/ค/ง) ที่อาจไม่ตรงหลังสลับตำแหน่ง',
    qs.every((q) => !/(ข้อ|ตัวเลือก)\s*[กขคง][\s.)]/.test(q.explanation)));
  check('ทุกข้อเป็นภาษาไทย', qs.every((q) => /[฀-๿]/.test(q.question)));
  check('ทุกข้อมีคำอธิบายภาษาไทย', qs.every((q) => /[฀-๿]/.test(q.explanation) && q.explanation.length > 40));

  check('ทุกข้อบอกเหตุผลว่าทำไมตัวเลือกที่ผิดจึงผิด (3 เหตุผลต่อข้อ)',
    qs.every((q) => Array.isArray(q.choiceNotes) && q.choiceNotes.filter((t, i) => i !== q.answer && /[฀-๿]/.test(t || '') && t.length > 15).length === 3 && q.choiceNotes[q.answer] === null),
    `${qs.filter((q) => Array.isArray(q.choiceNotes)).length}/60 ข้อ`);
  check('ตัวเลือกที่ถูกไม่ใช่ตัวที่ยาวที่สุดเสมอ (เดาจากความยาวไม่ได้)',
    qs.filter((q) => q.choices[q.answer].length === Math.max(...q.choices.map((c) => c.length))).length <= 30,
    `ตัวถูกยาวสุด ${qs.filter((q) => q.choices[q.answer].length === Math.max(...q.choices.map((c) => c.length))).length}/60 ข้อ`);

  const dist = [0, 0, 0, 0];
  qs.forEach((q) => dist[q.answer]++);
  check('เฉลยกระจาย ก/ข/ค/ง เท่ากัน (ไม่เดาได้จากตำแหน่ง)', dist.every((n) => n === 15), dist.join('/'));

  const usedDocs = new Set(qs.map((q) => q.source.doc));
  const allDocs = Object.keys(bank.sources);
  check('อ้างอิงครบทุกไฟล์สไลด์ที่ได้รับ', allDocs.every((d) => usedDocs.has(d)), `${usedDocs.size}/${allDocs.length} ไฟล์`);

  const topics = Object.keys(bank.topics);
  check('ใช้ครบทุกหมวด', topics.every((t) => qs.some((q) => q.topic === t)), `${topics.length} หมวด`);

  // scoring maths
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const s = createSession('exam', qs.map((q) => q.id));
  qs.forEach((q, i) => {
    if (i < 45) s.answers[q.id] = q.answer;              // 45 correct
    else if (i < 55) s.answers[q.id] = (q.answer + 1) % 4; // 10 wrong
  });                                                     // 5 unanswered
  const r = scoreSession(s, byId);
  check('คำนวณคะแนน 45/60 = 75%', r.correct === 45 && r.wrong === 10 && r.unanswered === 5 && r.percent === 75,
    JSON.stringify({ c: r.correct, w: r.wrong, u: r.unanswered, p: r.percent }));
  const s2 = createSession('exam', qs.map((q) => q.id));
  qs.slice(0, 7).forEach((q) => { s2.answers[q.id] = q.answer; });
  check('คำนวณเปอร์เซ็นต์ทศนิยม 7/60 = 11.67%', scoreSession(s2, byId).percent === 11.67, String(scoreSession(s2, byId).percent));
  check('รูปแบบเลขหน้า', formatPages([6, 7, 8]) === '6–8' && formatPages([26, 28]) === '26, 28' && formatPages([3]) === '3');
  check('ข้อความอ้างอิงมีชื่อไฟล์และเลขหน้า', citation(qs[0], bank.sources) === 'Chapter8_BigData_Part1.pdf • หน้า 2', citation(qs[0], bank.sources));
  const perDoc = {};
  qs.forEach((q) => { perDoc[q.source.doc] = (perDoc[q.source.doc] || 0) + 1; });
  check('ทุกไฟล์มีข้อสอบอย่างน้อย 10 ข้อ', Object.values(perDoc).every((n) => n >= 10), JSON.stringify(perDoc));

  // wrong-answers book
  const ids3 = qs.slice(0, 3).map((q) => q.id);
  const ans = { [ids3[0]]: qs[0].answer, [ids3[1]]: (qs[1].answer + 1) % 4 }; // 1 correct, 1 wrong, 1 blank
  let book = updateWrongBook([ids3[0]], ids3, ans, byId);
  check('Wrong book: ตอบถูกแล้วออก ตอบผิด/ไม่ตอบแล้วเข้า', !book.includes(ids3[0]) && book.includes(ids3[1]) && book.includes(ids3[2]) && book.length === 2, book.join(','));
  book = updateWrongBook(book, [ids3[1]], { [ids3[1]]: qs[1].answer }, byId);
  check('Wrong book: แก้ข้อผิดให้ถูกแล้วถูกลบออก', book.length === 1 && book[0] === ids3[2], book.join(','));
  check('ข้อที่ต้องทบทวน = ผิด + ไม่ได้ตอบ (15 ข้อจากรอบ 45/60)', idsToPractice(s, byId).length === 15);

  fs.writeFileSync(path.join(__dirname, 'last-validate.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
