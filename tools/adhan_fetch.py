"""Transcribe the sample adhan recordings to check which phrases each one contains. Temporary helper."""
import json, glob
from faster_whisper import WhisperModel
m = WhisperModel('small', device='cpu', compute_type='int8')
for f in sorted(glob.glob('s/adhan*.mp3')):
    segs, _ = m.transcribe(f, language='ar', beam_size=1)
    print('====', f, flush=True)
    for s in segs: print('  %5.0f  %s' % (s.start, s.text.strip()), flush=True)
