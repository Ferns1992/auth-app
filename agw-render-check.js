const B = 'http://127.0.0.1:4040';

(async () => {
  const lr = await fetch(B + '/admin/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=VerifyAdminPass123!'
  });
  const cookie = lr.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  const dash = await (await fetch(B + '/admin/dashboard', { headers: { cookie } })).text();
  const badge = dash.split('\n').find((l) => l.includes('person-circle'));
  console.log('--- navbar admin badge as rendered ---');
  console.log(badge ? badge.trim() : 'NOT FOUND');
  console.log('--- admin username visible ---');
  console.log(/admin<\/span>/.test(dash) ? 'yes' : 'no');

  for (const path of ['/admin/dashboard', '/admin/users', '/admin/apps', '/admin/logs']) {
    const html = await (await fetch(B + path, { headers: { cookie } })).text();
    const m = html.match(/nav-link active[^>]*>([^<]*)</);
    console.log(`active tab on ${path.padEnd(18)} -> ${m ? m[1] : 'NOT FOUND'}`);
  }

  const csv = await (await fetch(B + '/admin/logs.csv', { headers: { cookie } })).text();
  console.log('csv lines:', csv.split('\n').length - 1);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
