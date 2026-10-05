"""Browser -> production modules -> disposable Nginx stdout. Never deploys the app.

Requires Python Playwright/Chromium, Docker locally or an explicitly supplied
SSH host with Docker, and an authorized original Emerald ROM. All evidence
and private fixture bytes are excluded from Git under test-data/.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import io
import json
from pathlib import Path
import shlex
import socket
import subprocess
import tarfile
import time
import uuid
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
TESTS = Path(__file__).resolve().parent
ROM_SHA = 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af'
PATCH_SHA = 'e12480bad322c9bbb20ebba943ab5d1987001657e0f69d74f5cd94d6ba20a6b3'

def expected_rtc_seed(calendar):
    """Independent game/core calendar conversion, including their BCD behavior.

    Sources: pret/pokeemerald src/rtc.c RtcGetMinuteCount/ConvertDateToDayCount;
    src/main.c SeedRngWithRtc; mgba src/gba/cart/gpio.c _rtcUpdateClock/_rtcBCD.
    mGBA converts tm_year-100 as unsigned, so pre-2000 epoch dates wrap.
    Emerald uses binary day count but raw BCD hour/minute in its minute formula.
    """
    year = ((calendar['year'] - 2000) & 0xffffffff) % 100
    leap = lambda y: y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    days = sum(366 if leap(y) else 365 for y in range(year))
    days += sum([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][:calendar['month'] - 1])
    days += calendar['day'] + (1 if calendar['month'] > 2 and leap(year) else 0)
    bcd = lambda value: (value // 10) * 16 + value % 10
    minutes = days * 1440 + bcd(calendar['hour']) * 60 + bcd(calendar['minute'])
    return (minutes >> 16) ^ (minutes & 0xffff)

async def verify_expected_seed(page, event):
    calendar = await page.evaluate('timestamp => { const d=new Date(timestamp); return {year:d.getFullYear(),month:d.getMonth()+1,day:d.getDate(),hour:d.getHours(),minute:d.getMinutes()} }', event['virtualTimestamp'])
    expected = expected_rtc_seed(calendar)
    event['expectedRtcSeed'] = expected
    event['rtcCalendar'] = calendar
    if event['seed'] is not None: assert event['seed'] == expected, (event['seed'], expected, calendar)

class Fixture:
    def __init__(self, args, output):
        self.args, self.output = args, output
        self.name = 'frontend-observability-test-' + uuid.uuid4().hex[:12]
        self.remote_dir = '/tmp/' + self.name
        self.tunnel = None
    def ssh_prefix(self):
        return ['ssh', '-i', str(self.args.ssh_identity), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']
    def command(self, command):
        if self.args.ssh_target:
            result = subprocess.run([*self.ssh_prefix(), self.args.ssh_target, command], capture_output=True, text=True, timeout=60)
        else:
            result = subprocess.run(shlex.split(command), capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(f'{command.split()[0]} failed: {result.stderr[-2000:]}')
        return result.stdout.strip()
    def start(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as archive:
            def add(path, name):
                archive.add(path, arcname=name, filter=lambda info: self.mode(info))
            for path in (ROOT / 'apps/packages').iterdir():
                if path.suffix in ('.mjs', '.js', '.json'):
                    add(path, 'apps/packages/' + path.name)
                    add(path, 'html/apps/packages/' + path.name)
            add(ROOT / 'apps/frontend/server/frontend-events-nginx.mjs', 'apps/frontend/server/frontend-events-nginx.mjs')
            nginx = (ROOT / 'deploy/nginx.conf').read_text().replace('listen 8080;', '\n'.join(f'listen {8080 + i};' for i in range(9))).encode()
            info = tarfile.TarInfo('nginx.conf'); info.size = len(nginx); info.mode = 0o644
            archive.addfile(info, io.BytesIO(nginx))
            add(ROOT / 'deploy/15-frontend-events.sh', 'bootstrap.sh')
            add(TESTS / 'backend-trap.conf', 'backend-trap.conf')
            add(TESTS / 'fixture.html', 'html/fixture.html')
            add(TESTS / 'fixture.html', 'html/player.html')
            add(self.args.rom, 'html/fixture/emerald.gba')
            add(ROOT / 'assets/ips/Pokemon Emerald' / (ROM_SHA + '.ips'), 'html/fixture/emerald.ips')
        if self.args.ssh_target:
            self.command('mkdir -p ' + self.remote_dir)
            subprocess.run([*self.ssh_prefix(), self.args.ssh_target, 'tar -xf - -C ' + self.remote_dir], input=data.getvalue(), check=True, capture_output=True, timeout=60)
            directory = self.remote_dir
        else:
            directory = str(self.output / 'fixture')
            Path(directory).mkdir()
            with tarfile.open(fileobj=io.BytesIO(data.getvalue())) as archive:
                archive.extractall(directory, filter='data')
        self.directory = directory
        mounts = [('-v', directory + ':/opt/emulator-hub:ro'), ('-v', directory + '/html:/usr/share/nginx/html:ro'),
                  ('-v', directory + '/nginx.conf:/etc/nginx/conf.d/default.conf:ro'),
                  ('-v', directory + '/backend-trap.conf:/etc/nginx/conf.d/backend-trap.conf:ro'),
                  ('-v', directory + '/bootstrap.sh:/docker-entrypoint.d/15-frontend-events.sh:ro')]
        args = ['docker', 'run', '-d', '--name', self.name, '--add-host', 'backend:127.0.0.1', '-p', '127.0.0.1::8080']
        for i in range(1, 9): args.extend(['-p', f'127.0.0.1::{8080 + i}'])
        for pair in mounts: args.extend(pair)
        args.append(self.args.image)
        self.command(shlex.join(args))
        try: self.command('docker exec ' + self.name + ' nginx -t')
        except Exception:
            print(self.logs(), flush=True)
            raise
        ports = [int(line.rsplit(':', 1)[1]) for line in self.command('docker port ' + self.name).splitlines()]
        if self.args.ssh_target:
            local_ports = []
            reserved = []
            for _ in ports:
                sock = socket.socket(); sock.bind(('127.0.0.1', 0)); reserved.append(sock); local_ports.append(sock.getsockname()[1])
            forwarding = []
            for local_port, remote_port in zip(local_ports, ports): forwarding.extend(['-L', f'127.0.0.1:{local_port}:127.0.0.1:{remote_port}'])
            for sock in reserved: sock.close()
            self.tunnel = subprocess.Popen([*self.ssh_prefix(), '-o', 'ExitOnForwardFailure=yes', '-N', *forwarding, self.args.ssh_target], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            ports = local_ports
        self.urls = [f'http://127.0.0.1:{port}' for port in ports]
        port = ports[0]
        self.url = f'http://127.0.0.1:{port}'
        for _ in range(50):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.2): return
            except OSError: time.sleep(.1)
        raise RuntimeError('fixture port unavailable')
    @staticmethod
    def mode(info):
        info.mode = 0o755 if info.name.endswith('.sh') or info.isdir() else 0o644
        return info
    def logs(self):
        command = ['docker', 'logs', self.name]
        if self.args.ssh_target: command = [*self.ssh_prefix(), self.args.ssh_target, shlex.join(command)]
        # Docker stdout/stderr are distinct streams. Merging them during SSH can
        # interleave an Nginx notice in the middle of a JSON stdout record.
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        self.stderr_logs = result.stderr
        return result.stdout
    def stop(self):
        if self.tunnel: self.tunnel.terminate(); self.tunnel.wait(timeout=10)
        try: self.command('docker rm -f ' + self.name)
        finally:
            if self.args.ssh_target:
                # This exact fresh UUID path is owned exclusively by this fixture.
                self.command('rm -rf -- ' + self.remote_dir)

async def run(args):
    assert hashlib.sha256(args.rom.read_bytes()).hexdigest() == ROM_SHA, 'unsupported original ROM'
    assert hashlib.sha256((ROOT / 'assets/ips/Pokemon Emerald' / (ROM_SHA + '.ips')).read_bytes()).hexdigest() == PATCH_SHA
    output = ROOT / 'test-data/frontend-observability' / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])
    output.mkdir(parents=True)
    fixture = Fixture(args, output)
    result = {'tests': [], 'events': [], 'fixture': fixture.name}
    def passed(name, evidence=None):
        result['tests'].append({'name': name, 'passed': True, 'evidence': evidence}); print('PASS', name, flush=True)
    try:
        fixture.start()
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=['--autoplay-policy=no-user-gesture-required'])
            context = await browser.new_context()
            page = await context.new_page()
            page.on('pageerror', lambda error: print('PAGEERROR', str(error), flush=True))
            page.on('console', lambda message: print('BROWSER', message.text[:400], flush=True) if message.type == 'error' else None)
            requests = []
            context.on('request', lambda request: requests.append(request.url))
            await page.goto(fixture.url + '/fixture.html?session=real-patched')
            await page.wait_for_function('window.__rngE2E?.manager', timeout=120000)
            await page.wait_for_timeout(1000)
            passed('real EmulatorJS 4.2.3 started with original ROM and production IPS')
            for minute, reset_type, speed in [(1, 'soft', 1), (1, 'soft', 1), (2, 'soft', 1), (4, 'soft', 5), (3, 'hard', 1)]:
                previous = await page.evaluate('window.__rngE2E.events.length')
                await page.evaluate('([minute, type, speed]) => window.__rngE2E.reset(minute, type, speed)', [minute, reset_type, speed])
                await page.wait_for_function('(n) => window.__rngE2E.events.length > n', arg=previous, timeout=10000)
                event = await page.evaluate('window.__rngE2E.events.at(-1)')
                assert event['samples'] and event['rngValue'] is not None
                assert event['virtualTimestamp'] == minute * 60000
                await verify_expected_seed(page, event)
                result['events'].append(event)
                passed(f'{reset_type} minute {minute} speed {speed}: RNG emitted with explicit seed evidence', event)
            assert result['events'][0]['seed'] is not None
            assert result['events'][0]['seed'] == result['events'][1]['seed']
            assert result['events'][2]['seed'] != result['events'][1]['seed']
            passed('fixed RTC repeats seed and advancing RTC changes the observed seed')
            passed('observed patched seeds match independent game and mGBA RTC conversion')
            for event in result['events']:
                if event['seed'] is not None:
                    proof = [item for item in event['samples'] if event['seedFrame'] <= item['frame'] <= event['seedFrame'] + 3]
                    assert len(proof) == 4 and proof[0]['rngValue'] == event['seed']
                    for previous, current in zip(proof, proof[1:]):
                        assert current['frame'] == previous['frame'] + 1
                        assert current['rngValue'] == (previous['rngValue'] * 0x41c64e6d + 0x6073) & 0xffffffff
            passed('seed proof remains in the bounded stdout samples')
            # Original ROM is an independent negative/control case.
            control = await context.new_page()
            await control.goto(fixture.url + '/fixture.html?session=real-unpatched&patched=0')
            await control.wait_for_function('window.__rngE2E?.manager', timeout=120000)
            await control.wait_for_function('window.__rngE2E.manager.getFrameNum() >= 90', timeout=120000)
            # Under host contention a passive sampler may honestly miss a frame.
            # Preserve those attempts; require one actual zero proof within five.
            for _ in range(5):
                count = await control.evaluate('window.__rngE2E.events.length')
                await control.evaluate('window.__rngE2E.reset(7)')
                await control.wait_for_function('(n) => window.__rngE2E.events.length > n', arg=count, timeout=10000)
                original_event = await control.evaluate('window.__rngE2E.events.at(-1)')
                assert original_event['seed'] in (None, 0)
                result['events'].append(original_event)
                if original_event['seed'] == 0: break
            assert original_event['seed'] == 0, 'negative control did not capture seed proof within its sampling budget'
            passed('unpatched Emerald control logs seed zero')
            await control.close()
            # Nine isolated origins share the frontend collector without backend.
            async def one_player(index):
                ctx = await browser.new_context()
                item = await ctx.new_page()
                await item.goto(fixture.urls[index] + f'/player.html?session=nine-{index}')
                await item.wait_for_function('window.__rngE2E?.manager', timeout=120000)
                await item.wait_for_function('window.__rngE2E.manager.getFrameNum() >= 90', timeout=120000)
                return ctx, item
            players = await asyncio.gather(*(one_player(i) for i in range(9)))
            await asyncio.gather(*(item.evaluate('(minute) => window.__rngE2E.reset(minute)', i + 10) for i, (_, item) in enumerate(players)))
            for ctx, item in players:
                await item.wait_for_function('window.__rngE2E.events.length > 0', timeout=15000)
                event = await item.evaluate('window.__rngE2E.events.at(-1)')
                assert event['rngValue'] is not None and event['samples']
                assert event['seed'] != 0, 'transient initialization zero must not be labeled final RTC seed'
                await verify_expected_seed(item, event)
                result['events'].append(event)
            passed('nine live cores across nine origins emit independent RNG logs')
            for ctx, _ in players: await ctx.close()
            threaded = await context.new_page()
            await threaded.goto(fixture.url + '/player.html?session=real-threaded&threads=1')
            await threaded.wait_for_function('window.__rngE2E?.manager', timeout=120000)
            assert await threaded.evaluate('crossOriginIsolated && window.__rngE2E.manager.Module.HEAPU8.buffer instanceof SharedArrayBuffer'), 'threaded case must use actual shared WASM memory'
            await threaded.evaluate('window.__rngE2E.reset(20)')
            await threaded.wait_for_function('window.__rngE2E.events.length > 0', timeout=10000)
            event = await threaded.evaluate('window.__rngE2E.events.at(-1)')
            assert event['rngValue'] is not None and event['samples'] and event['seed'] != 0
            await verify_expected_seed(threaded, event)
            result['events'].append(event)
            passed('actual threaded core emits RNG with measured capture limitations', event)
            await threaded.close()
            # Browser delivery failure must not stop a real reset or leave hooks.
            await page.route('**/_frontend/events', lambda route: route.abort())
            before_frame = await page.evaluate('window.__rngE2E.manager.getFrameNum()')
            await page.evaluate('window.__rngE2E.reset(9, "hard")')
            await page.wait_for_function('!window.__rngE2E.observer.active', timeout=10000)
            after_frame = await page.evaluate('window.__rngE2E.manager.getFrameNum()')
            assert after_frame > before_frame
            passed('offline collector cannot interrupt reset or emulator frame progress')
            await page.unroute('**/_frontend/events')
            await page.evaluate('async () => { await window.__rngE2E.reset(10, "hard"); window.__rngE2E.cancel() }')
            count_after_cancel = await page.evaluate('window.__rngE2E.events.length')
            await page.wait_for_timeout(2200)
            assert await page.evaluate('window.__rngE2E.events.length') == count_after_cancel
            passed('cancel disarms sampler and prevents stale reset logs')
            await page.evaluate('() => setTimeout(() => { throw new Error("frontend-e2e-uncaught") }, 0)')
            await page.evaluate('async () => { const { createSnapshotTelemetry } = await import("/apps/packages/snapshot-telemetry.mjs"); createSnapshotTelemetry({browser:window,source:"player",sessionId:"real-patched"}).info("snapshot.e2e",{status:200}) }')
            # Real HTTP handling for adversarial input, not a handler stub.
            basic = {'sessionId': 'http-contract', 'source': 'hub', 'kind': 'uncaught-error', 'message': 'line\n{"forged":true}', 'leaseToken': 'DO_NOT_LOG_THIS_TOKEN', 'state': [1, 2]}
            response = await context.request.post(fixture.url + '/_frontend/events', data=basic)
            assert response.status == 204
            passed('Nginx accepts bounded JSON event')
            for name, options, expected in [
                ('malformed JSON', {'data': '{', 'headers': {'Content-Type': 'application/json'}}, 400),
                ('wrong content type', {'data': '{}', 'headers': {'Content-Type': 'text/plain'}}, 415),
                ('cross-origin', {'data': basic, 'headers': {'Origin': 'https://other.invalid'}}, 403),
                ('oversized body', {'data': 'x' * 20000, 'headers': {'Content-Type': 'application/json'}}, 413),
            ]:
                response = await context.request.post(fixture.url + '/_frontend/events', **options)
                assert response.status == expected, (name, response.status)
                passed('Nginx rejects ' + name)
            assert (await context.request.get(fixture.url + '/_frontend/events')).status == 405
            passed('Nginx rejects unsupported method')
            burst = await asyncio.gather(*(context.request.post(fixture.url + '/_frontend/events', data={**basic, 'sessionId': 'rate-limit'}) for _ in range(200)))
            assert any(response.status == 429 for response in burst)
            passed('Nginx limits collector bursts with 429')
            # Delivery evidence is read from the actual container, not browser console.
            await page.wait_for_timeout(500)
            logs = fixture.logs()
            records = [json.loads(line) for line in logs.splitlines() if line.startswith('{')]
            assert len([event for event in records if event.get('kind') == 'rng-reset']) >= 5
            assert not any('/api/debug/client-events' in url for url in requests)
            assert 'BACKEND_TRAP' not in logs
            assert 'DO_NOT_LOG_THIS_TOKEN' not in logs
            assert not any(line.startswith('{"forged"') for line in logs.splitlines())
            assert len([event for event in records if event.get('sessionId', '').startswith('nine-') and event.get('kind') == 'rng-reset']) == 9
            assert all('receivedAt' in event and 'seed' in event for event in records if event.get('kind') == 'rng-reset')
            for event in result['events']:
                delivered = [record for record in records if record.get('eventId') == event['eventId']]
                assert len(delivered) == 1, ('missing or duplicated frontend stdout event', event['eventId'])
                for key in ['seed', 'rngValue', 'status', 'samples', 'cycleId']:
                    assert delivered[0][key] == event[key], ('browser/stdout mismatch', key)
            assert any(event.get('message') == 'frontend-e2e-uncaught' and event.get('kind') == 'uncaught-error' for event in records)
            assert any(event.get('message') == 'snapshot.e2e' and event.get('status') == 200 for event in records)
            passed('actual browser error and snapshot producer reach frontend stdout')
            passed('real RNG reset records reach frontend stdout without backend traffic')
            result['stdoutRecords'] = records
            result['passed'] = True
            await browser.close()
    finally:
        try: (output / 'container.stdout.log').write_text(fixture.logs(), encoding='utf8')
        except Exception: pass
        (output / 'container.stderr.log').write_text(getattr(fixture, 'stderr_logs', ''), encoding='utf8')
        (output / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf8')
        fixture.stop()
        print('ARTIFACTS', output, flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--image', default='nginx:1.29-alpine')
    parser.add_argument('--ssh-target')
    parser.add_argument('--ssh-identity', type=Path)
    args = parser.parse_args()
    if args.ssh_target and not args.ssh_identity: parser.error('--ssh-identity required with --ssh-target')
    asyncio.run(run(args))
