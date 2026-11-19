/*
 * ทดสอบใช้งานจริงแบบ end-to-end ด้วย Playwright (Chromium headless)
 * รัน:  node tests/e2e.test.cjs
 *   - ต้องมี playwright (npm i -D playwright) และ python3 สำหรับเปิด static server ชั่วคราว
 *   - BASE_URL=https://.../  → ทดสอบเว็บที่ deploy แล้วแทนการเปิด server ในเครื่อง
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8600 + Math.floor(Math.random() * 300);
const BASE = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/?$/, '/') : `http://127.0.0.1:${PORT}/`;
const URL = BASE + 'index.html';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8'));
const Q = bank.questions;

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
const st = (page) => page.evaluate(() => window.__quest.getState());
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const hidden = (page, sel) => page.$eval(sel, (e) => e.classList.contains('hidden'));
async function currentIndex(page) { return (await st(page)).session.current; }
async function goTo(page, i) { await page.click(`#navGrid .cell[data-index="${i}"]`); }
async function choose(page, idx) { await page.click(`#options .option[data-index="${idx}"]`); }
async function pickMode(page, mode) {
  await page.click('#modeBtn');
  await page.waitForSelector('#modal:not(.hidden) .mode-opt');
  await page.click(`#modal .mode-opt[data-mode="${mode}"]`);
  await page.click('#modalOk');
  await page.waitForSelector('#modal.hidden', { state: 'attached' });
}

async function main() {
  let server = null;
  if (!process.env.BASE_URL) {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 900));
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });

  try {
    // 1. load + start dialog
    await page.goto(URL);
    await page.waitForSelector('#modal:not(.hidden) #nameInput');
    record('หน้าเว็บโหลดได้และแสดงหน้าต่างเริ่มสอบ', true);
    const counts = await page.$$eval('.info-grid b', (b) => b.map((x) => x.textContent));
    record('หน้าเริ่มแสดง ง่าย 20 / ปานกลาง 20 / ยาก 20', counts.join('/') === '20/20/20', counts.join('/'));
    const modes = await page.$$eval('.mode-opt', (b) => b.map((x) => `${x.dataset.mode}:${x.classList.contains('active')}:${x.disabled}`));
    record('หน้าเริ่มมี 3 โหมด Exam / Practice / Wrong Answers Review (Wrong ปิดไว้เพราะยังไม่มีข้อผิด)',
      modes.join(',') === 'exam:true:false,practice:false:false,wrong:false:true', modes.join(','));
    await page.fill('#nameInput', 'เจมส์');
    await page.click('#modalOk');
    await page.waitForSelector('#modal.hidden', { state: 'attached' });
    record('เริ่มใน Exam Mode', (await st(page)).session.mode === 'exam' && (await text(page, '#modeBtnLabel')) === 'โหมดสอบ');
    const cells = await page.$$eval('#navGrid .cell', (c) => c.length);
    record('Navigator มี 60 ช่อง', cells === 60, cells);
    record('ชื่อเกม DATABASE & BIG DATA QUEST', (await text(page, '.brand-title')) === 'DATABASE & BIG DATA QUEST');
    record('แสดงชื่อผู้ทำ', (await text(page, '#takerName')) === 'เจมส์');
    record('เริ่มที่คำถามที่ 1 / 60', (await text(page, '#qCounter')) === 'คำถามที่ 1 / 60');
    record('ข้อ 1 เป็นข้อปัจจุบันใน navigator', await page.$eval('#navGrid .cell[data-index="0"]', (e) => e.classList.contains('current')));
    record('มีป้ายความยาก (ง่าย) และป้ายหัวข้อ', (await text(page, '#diffBadge')) === 'ง่าย' && (await text(page, '#topicBadge')) === 'Big Data & 5V');
    const letters = await page.$$eval('#options .letter', (l) => l.map((x) => x.textContent));
    record('ตัวเลือก ก ข ค ง ครบ 4 ตัว', letters.join('') === 'ก.ข.ค.ง.', letters.join(' '));
    record('ปุ่มย้อนกลับถูกปิดที่ข้อแรก', await page.$eval('#prevBtn', (b) => b.disabled));

    // 2. select + change answer
    await choose(page, 1);
    let s = await st(page);
    record('เลือกคำตอบแล้วนับ ตอบแล้ว 1 / 60', s.session.answers.Q01 === 1 && (await text(page, '#answeredCount')) === '1');
    record('ช่องข้อ 1 เปลี่ยนเป็นสถานะตอบแล้ว', await page.$eval('#navGrid .cell[data-index="0"]', (e) => e.classList.contains('answered')));
    await choose(page, 3);
    s = await st(page);
    record('เปลี่ยนคำตอบได้ (นับยังเป็น 1 และคำตอบใหม่ถูกบันทึก)', s.session.answers.Q01 === 3 && (await text(page, '#answeredCount')) === '1');
    record('ตัวเลือกที่เลือกถูกไฮไลต์เพียงตัวเดียว', (await page.$$('#options .option.selected')).length === 1);
    record('Exam Mode ไม่เฉลยระหว่างทำ', await hidden(page, '#feedback'));

    // 3. skip with next, prev
    await page.click('#nextBtn');
    await page.click('#nextBtn');
    record('ข้ามข้อด้วยปุ่มข้อถัดไป (ไปข้อ 3 โดยไม่ตอบข้อ 2)', (await currentIndex(page)) === 2 && (await st(page)).session.answers.Q02 === undefined);
    await page.click('#prevBtn');
    record('ปุ่มย้อนกลับไปข้อ 2', (await currentIndex(page)) === 1);
    await goTo(page, 2);
    record('ข้อที่มีโค้ดประกอบแสดงกล่องโค้ด (ข้อ 3 JSON)', !(await hidden(page, '#qCode')) && (await text(page, '#qCode')).includes('"photos"'));

    // 4. jump via navigator + mark
    await goTo(page, 44);
    record('คลิกหมายเลข 45 แล้วไปข้อ 45', (await text(page, '#qCounter')) === 'คำถามที่ 45 / 60');
    await page.click('#markBtn');
    record('Mark for Review ข้อ 45', await page.$eval('#navGrid .cell[data-index="44"]', (e) => e.classList.contains('marked'))
      && !(await hidden(page, '#markedBadge')));
    await page.keyboard.press('m');
    record('กด M ยกเลิกปักหมุด', !(await page.$eval('#navGrid .cell[data-index="44"]', (e) => e.classList.contains('marked'))));
    await page.keyboard.press('m');
    await page.keyboard.press('2');
    record('คีย์ลัด 2 เลือกตัวเลือก ข', (await st(page)).session.answers.Q45 === 1);
    await page.keyboard.press('ArrowRight');
    record('คีย์ลัด → ไปข้อถัดไป', (await currentIndex(page)) === 45);
    const statusClasses = await page.$eval('#navGrid', (g) => ({
      cur: g.children[45].className, ans: g.children[0].className, mark: g.children[44].className, empty: g.children[1].className,
    }));
    record('Navigator แยกสถานะ ยังไม่ตอบ / ตอบแล้ว / ปักหมุด / ข้อปัจจุบัน',
      statusClasses.cur.includes('current') && statusClasses.ans.includes('answered')
      && statusClasses.mark.includes('marked') && statusClasses.empty === 'cell', JSON.stringify(statusClasses));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-exam.png') });

    // 5. refresh keeps progress
    await page.reload();
    await page.waitForFunction(() => window.__quest && window.__quest.getState().session);
    s = await st(page);
    record('Refresh แล้ว progress ไม่หาย (คำตอบ, ปักหมุด, ข้อปัจจุบัน, ชื่อ)',
      s.session.answers.Q01 === 3 && s.session.answers.Q45 === 1 && s.session.marked.includes('Q45')
      && s.session.current === 45 && s.name === 'เจมส์' && (await text(page, '#answeredCount')) === '2'
      && (await hidden(page, '#modal')));

    // 6. answer the whole exam: 45 correct, 10 wrong, 5 unanswered (via UI clicks)
    for (let i = 0; i < 60; i++) {
      await goTo(page, i);
      const q = Q[i];
      if (i < 45) await choose(page, q.answer);
      else if (i < 55) await choose(page, (q.answer + 1) % 4);
      else if ((await st(page)).session.answers[q.id] !== undefined) throw new Error('unexpected answer');
    }
    record('ตอบผ่าน UI ครบ 55 ข้อ', (await text(page, '#answeredCount')) === '55');
    const progressW = await page.$eval('#progressFill', (e) => e.style.width);
    record('Progress bar ตรงกับจำนวนที่ตอบ (55/60)', Math.abs(parseFloat(progressW) - (55 / 60) * 100) < 0.01, progressW);

    // 7. submit with confirm
    await goTo(page, 59);
    record('ข้อสุดท้ายปุ่มเปลี่ยนเป็นส่งข้อสอบ', (await text(page, '#nextBtn')).startsWith('ส่งข้อสอบ'));
    await page.click('#submitBtn');
    await page.waitForSelector('#modal:not(.hidden)');
    const confirmText = await text(page, '#modalBody');
    record('หน้ายืนยันเตือนข้อที่ยังไม่ตอบ 5 ข้อและข้อที่ปักหมุด', confirmText.includes('ยังไม่ได้ตอบอีก 5 ข้อ') && confirmText.includes('ทำเครื่องหมายทบทวนไว้ 1 ข้อ'), confirmText);
    await page.click('#modalCancel');
    record('กดกลับไปทำต่อ ยังไม่ส่ง', !(await st(page)).session.submitted);
    await page.click('#submitBtn');
    await page.click('#modalOk');
    await page.waitForSelector('#resultView:not(.hidden)');
    const pct = await text(page, '#scorePct');
    const sub = await text(page, '#scoreSub');
    record('คะแนน 45 / 60 = 75%', pct === '75%' && sub === '45 / 60 ข้อ', `${pct} ${sub}`);
    const bars = await page.$$eval('.bar-row .val', (v) => v.map((x) => x.textContent));
    // Q01-20 easy, Q21-40 medium, Q41-60 hard → easy 20/20, medium 20/20, hard 5/20
    record('คะแนนแยกตามระดับถูกต้อง (ง่าย 20/20, ปานกลาง 20/20, ยาก 5/20)',
      bars[0] === '20/20 (100%)' && bars[1] === '20/20 (100%)' && bars[2] === '5/20 (25%)', bars.join(' | '));
    const topicSum = await page.$$eval('#topicTable tbody tr', (rows) => rows.reduce((a, r) => [a[0] + +r.children[1].textContent, a[1] + +r.children[2].textContent], [0, 0]));
    record('ตารางหมวดรวมได้ 45 / 60 ครบ 6 หมวด', topicSum[0] === 45 && topicSum[1] === 60
      && (await page.$$('#topicTable tbody tr')).length === 6, topicSum.join('/'));
    s = await st(page);
    const expectedWrong = Q.slice(45).map((q) => q.id);
    record('ส่งข้อสอบแล้ว ข้อผิด 10 + ไม่ได้ตอบ 5 เข้า Wrong Answers Review (15 ข้อ)',
      JSON.stringify(s.wrongBook) === JSON.stringify(expectedWrong) && (await text(page, '#wrongCount')) === '15', s.wrongBook.length);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-result.png'), fullPage: true });

    // 8. refresh on result
    await page.reload();
    await page.waitForSelector('#resultView:not(.hidden)');
    record('Refresh หน้าผลสอบแล้วผลยังอยู่', (await text(page, '#scorePct')) === '75%');

    // 9. review with explanations + citation
    await page.click('#reviewBtn');
    await page.waitForSelector('#feedback:not(.hidden)');
    const src = await text(page, '#feedbackSource');
    record('ดูเฉลยแสดงคำอธิบายและไฟล์/หน้าอ้างอิง', src.includes('Chapter8_BigData_Part1.pdf') && src.includes('หน้า 2'), src);
    record('คำอธิบายที่แสดงตรงกับคลังข้อสอบ', (await text(page, '#feedbackText')) === Q[0].explanation);
    const reasons = await page.$$eval('#choiceReasons .reason', (r) => r.map((x) => x.className + '|' + x.querySelector('.reason-why').textContent));
    record('เฉลยบอกเหตุผลครบ 4 ตัวเลือก (ถูก 1 ข้อ + ทำไมผิดอีก 3 ข้อ)',
      reasons.length === 4 && reasons.filter((r) => r.includes('is-wrong') && r.includes('ผิดเพราะ ')).length === 3
      && reasons[Q[0].answer].includes('is-right'), reasons.length);
    record('เหตุผลของตัวเลือกผิดตรงกับคลังข้อสอบ', reasons.every((r, i) => i === Q[0].answer || r.endsWith(Q[0].choiceNotes[i])));
    record('ดูเฉลยล็อกตัวเลือกและไฮไลต์คำตอบที่ถูก', await page.$eval(`#options .option[data-index="${Q[0].answer}"]`, (e) => e.classList.contains('correct') && e.disabled));
    await page.click('#reviewFilter .chip[data-filter="wrong"]');
    const wrongChip = await text(page, '#reviewFilter .chip[data-filter="wrong"]');
    record('กรองข้อที่ตอบผิดได้ 10 ข้อ และไปข้อ 46', wrongChip.includes('(10)') && (await currentIndex(page)) === 45, wrongChip);
    record('ข้อที่ผิดแสดงคำตอบของผู้ใช้เป็นสีแดง', (await page.$$('#options .option.wrong')).length === 1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-review.png') });
    await page.click('#reviewFilter .chip[data-filter="unanswered"]');
    record('กรองข้อที่ไม่ได้ตอบได้ 5 ข้อ', (await text(page, '#reviewFilter .chip[data-filter="unanswered"]')).includes('(5)') && (await currentIndex(page)) === 55);
    await page.click('#submitBtn'); // = กลับไปหน้าคะแนน
    await page.waitForSelector('#resultView:not(.hidden)');

    // 10. Wrong Answers Review from the result page
    const pbText = await text(page, '#practiceBtn');
    record('ปุ่มทบทวนข้อที่ผิดนับ 15 ข้อ', pbText.includes('(15 ข้อ)'), pbText);
    await page.click('#practiceBtn');
    await page.waitForSelector('#examView:not(.hidden)');
    s = await st(page);
    record('Wrong Answers Review มีเฉพาะข้อที่ผิด/ไม่ได้ตอบ', s.session.mode === 'wrong'
      && JSON.stringify(s.session.ids) === JSON.stringify(expectedWrong) && (await text(page, '#qCounter')) === 'คำถามที่ 1 / 15');
    await choose(page, (Q[45].answer + 1) % 4);
    record('Wrong Answers Review เฉลยทันทีพร้อมคำอธิบาย', !(await hidden(page, '#feedback')) && (await text(page, '#feedbackTitle')).startsWith('ตอบผิด'));
    record('ตัวเลือกถูกปิดหลังตรวจแล้ว', (await page.$$eval('#options .option', (o) => o.every((x) => x.disabled))));
    await page.keyboard.press(String(Q[45].answer + 1)); // try to change via keyboard
    record('ตอบแล้วเปลี่ยนไม่ได้', (await st(page)).session.answers[Q[45].id] === (Q[45].answer + 1) % 4);
    for (let i = 1; i < 15; i++) { await goTo(page, i); await choose(page, Q[45 + i].answer); }
    s = await st(page);
    record('ตอบถูกแล้วข้อนั้นออกจาก Wrong Answers Review (เหลือ 1 ข้อ)', JSON.stringify(s.wrongBook) === JSON.stringify([Q[45].id]) && (await text(page, '#wrongCount')) === '1', s.wrongBook.join(','));
    await page.click('#submitBtn');
    await page.click('#modalOk');
    await page.waitForSelector('#resultView:not(.hidden)');
    record('ผลรอบทบทวน 14 / 15', (await text(page, '#scoreSub')) === '14 / 15 ข้อ' && (await text(page, '#resultEyebrow')) === 'ผลการทบทวนข้อที่ผิด');
    record('ทบทวนซ้ำข้อที่ยังผิด เหลือ 1 ข้อ', (await text(page, '#practiceBtn')).includes('(1 ข้อ)'));
    await page.click('#backToExamResultBtn');
    record('กลับไปผลสอบหลักได้ (75%)', (await text(page, '#scorePct')) === '75%' && (await text(page, '#resultEyebrow')) === 'ผลการสอบ (Exam Mode)');

    // 11. Practice Mode via the header mode menu
    await page.click('#modeBtn');
    await page.waitForSelector('#modal:not(.hidden) .mode-opt');
    const menu = await page.$$eval('#modal .mode-opt', (b) => b.map((x) => x.dataset.mode + ':' + x.disabled + ':' + (x.querySelector('.tag')?.textContent || '')));
    record('เมนูโหมดมี 3 โหมด และ Wrong Answers Review แสดง 1 ข้อ', menu.length === 3 && menu[2] === 'wrong:false:1 ข้อ', menu.join(','));
    await page.click('#modal .mode-opt[data-mode="practice"]');
    await page.click('#modalOk');
    s = await st(page);
    record('เข้า Practice Mode: เริ่มข้อ 1 ครบ 60 ข้อ ยังไม่มีคำตอบ',
      s.session.mode === 'practice' && s.session.ids.length === 60 && Object.keys(s.session.answers).length === 0
      && (await text(page, '#modeChip')) === 'Practice Mode' && (await text(page, '#modeBtnLabel')) === 'โหมดฝึก');
    const wrong0 = (Q[0].answer + 2) % 4;
    await page.keyboard.press(String(wrong0 + 1));
    record('Practice Mode เฉลยทันทีหลังเลือก (ข้อผิด)', !(await hidden(page, '#feedback')) && (await text(page, '#feedbackTitle')).startsWith('ตอบผิด'));
    const chosenReason = await page.$eval('#choiceReasons .reason.is-chosen', (e) => e.textContent);
    record('บอกว่าทำไมตัวที่เลือกผิด', chosenReason.includes('คุณเลือก') && chosenReason.includes(Q[0].choiceNotes[wrong0]));
    record('แสดงไฟล์และหน้าอ้างอิงทันที', (await text(page, '#feedbackSource')).includes('Chapter8_BigData_Part1.pdf • หน้า 2'));
    record('ตอบผิดใน Practice Mode แล้วเข้า Wrong Answers Review (รวม 2 ข้อ)', JSON.stringify((await st(page)).wrongBook) === JSON.stringify(['Q01', Q[45].id]));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-practice.png'), fullPage: true });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press(String(Q[1].answer + 1));
    record('Practice Mode เฉลยทันทีหลังเลือก (ข้อถูก)', (await text(page, '#feedbackTitle')).startsWith('ตอบถูก'));

    // 12. switching modes keeps progress of each mode
    await pickMode(page, 'exam');
    s = await st(page);
    record('สลับไป Exam Mode ได้รอบใหม่ (รอบเดิมส่งแล้ว) และเก็บ Practice ที่ทำค้างไว้',
      s.session.mode === 'exam' && Object.keys(s.session.answers).length === 0 && s.stash.practice
      && Object.keys(s.stash.practice.answers).length === 2);
    await choose(page, Q[0].answer);
    await page.reload();
    await page.waitForFunction(() => window.__quest && window.__quest.getState().session);
    s = await st(page);
    record('Refresh แล้วยังอยู่ Exam Mode รอบใหม่ และ Practice ที่ค้างไว้ยังอยู่', s.session.mode === 'exam'
      && s.session.answers.Q01 === Q[0].answer && Object.keys(s.stash.practice.answers).length === 2);
    await pickMode(page, 'practice');
    s = await st(page);
    record('กลับไป Practice Mode แล้วทำต่อจากเดิม (ตอบไว้ 2 ข้อ อยู่ข้อ 2)', s.session.mode === 'practice'
      && Object.keys(s.session.answers).length === 2 && s.session.current === 1 && s.stash.exam
      && (await text(page, '#answeredCount')) === '2');

    // 13. Wrong Answers Review from the menu clears the book when answered correctly
    await pickMode(page, 'wrong');
    s = await st(page);
    record('เปิด Wrong Answers Review จากเมนู ได้ 2 ข้อ (Q01, ' + Q[45].id + ')', s.session.mode === 'wrong'
      && JSON.stringify(s.session.ids) === JSON.stringify(['Q01', Q[45].id]));
    await choose(page, Q[0].answer);
    await goTo(page, 1);
    await choose(page, Q[45].answer);
    s = await st(page);
    record('ตอบถูกครบแล้ว Wrong Answers Review ว่าง และตัวนับในหัวเว็บหายไป', s.wrongBook.length === 0 && (await hidden(page, '#wrongCount')));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-wrong-review.png'), fullPage: true });
    await page.click('#modeBtn');
    await page.waitForSelector('#modal:not(.hidden) .mode-opt');
    record('เมื่อไม่มีข้อผิด ตัวเลือก Wrong Answers Review ถูกปิด', await page.$eval('#modal .mode-opt[data-mode="wrong"]', (b) => b.disabled));
    await page.click('#modal .mode-opt[data-mode="practice"]');
    await page.click('#modalOk');

    // 14. finish Practice Mode with the keyboard: Q01 wrong (already), rest correct
    s = await st(page);
    record('กลับมา Practice Mode เดิม', s.session.mode === 'practice' && Object.keys(s.session.answers).length === 2);
    for (let i = 1; i < 60; i++) {
      if (i > 1) await page.keyboard.press(String(Q[i].answer + 1));
      if (i < 59) await page.keyboard.press('ArrowRight');
    }
    record('ข้อสุดท้ายปุ่มเปลี่ยนเป็นดูสรุปคะแนน', (await text(page, '#nextBtn')).startsWith('ดูสรุปคะแนน'));
    await page.keyboard.press('ArrowRight'); // last question → submit dialog
    await page.waitForSelector('#modal:not(.hidden)');
    await page.click('#modalOk');
    await page.waitForSelector('#resultView:not(.hidden)');
    record('ผล Practice Mode 59/60', (await text(page, '#scoreSub')) === '59 / 60 ข้อ'
      && (await text(page, '#resultEyebrow')) === 'ผล Practice Mode' && (await text(page, '#practiceBtn')).includes('(1 ข้อ)'),
      await text(page, '#scoreSub'));

    record('ไม่มี error ใน console', errors.length === 0, errors.join(' | '));

    // 15. Mobile layout
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(URL);
    await mp.waitForSelector('#nameInput');
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-start.png') });
    await mp.click('.mode-opt[data-mode="practice"]');
    await mp.fill('#nameInput', 'เจมส์');
    await mp.click('#modalOk');
    await mp.goto(URL); // reload in mobile
    await mp.waitForFunction(() => window.__quest && window.__quest.getState().session);
    await mp.tap('#navGrid .cell[data-index="51"]'); // Q52: aggregation with code block
    await mp.tap('#options .option[data-index="0"]');
    record('มือถือ: Practice Mode แสดงเหตุผลครบ 4 ตัวเลือก',
      (await mp.$$('#choiceReasons .reason')).length === 4 && !(await hidden(mp, '#feedback')));
    await mp.tap('#markBtn');
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    record('มือถือ 390px ไม่มี scroll แนวนอน', overflow <= 0, overflow);
    const btnBox = await mp.$$eval('.q-actions .btn', (bs) => bs.map((b) => b.getBoundingClientRect()).map((r) => Math.round(r.right)));
    record('ปุ่ม Previous / Mark / Next อยู่ในจอมือถือ', btnBox.every((r) => r <= 390), btnBox.join(','));
    const modeBtnBox = await mp.$eval('#modeBtn', (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= 390; });
    record('มือถือ: ปุ่มเลือกโหมดมองเห็นและอยู่ในจอ', modeBtnBox);
    record('มือถือ: เลือกคำตอบและปักหมุดได้', (await mp.evaluate(() => window.__quest.getState().session.marked.includes('Q52'))));
    await mp.evaluate(() => window.scrollTo(0, 0));
    await mp.waitForTimeout(400);
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-exam.png') });
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-full.png'), fullPage: true });
    await mp.$eval('#feedback', (e) => e.scrollIntoView({ block: 'start' }));
    await mp.waitForTimeout(300);
    await mp.screenshot({ path: path.join(SHOTS, 'mobile-practice.png') });
    await m.close();
  } catch (e) {
    record('ข้อผิดพลาดระหว่างทดสอบ', false, e.stack || e.message);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
main();
