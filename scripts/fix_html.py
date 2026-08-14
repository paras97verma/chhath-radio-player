import html as h
c = open('code-map.html').read()
fixed = h.unescape(c)
open('code-map.html','w').write(fixed)
print('Done, size:', len(fixed))