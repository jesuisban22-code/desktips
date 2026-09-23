import json,subprocess,sys
from PIL import Image, ImageDraw
base,out,pieces = sys.argv[1],sys.argv[2],sys.argv[3]
angles = sys.argv[4] if len(sys.argv)>4 else '35:18,140:16,-55:10'
rov = sys.argv[5] if len(sys.argv)>5 else ''
r=subprocess.run(['node','scripts/sheet.mjs',base,out,pieces,angles,rov],capture_output=True,text=True)
line=[l for l in r.stdout.strip().split('\n') if l.startswith('{')][-1]
d=json.loads(line); cols=d['cols']; shots=d['shots']
rows=(len(shots)+cols-1)//cols
W,H=560,480
im=Image.new('RGB',(W*cols,H*rows),(18,14,9)); dr=ImageDraw.Draw(im)
for i,(piece,a,e,f,errs) in enumerate(shots):
    im.paste(Image.open(f),(W*(i%cols),H*(i//cols)))
    dr.text((W*(i%cols)+8,H*(i//cols)+6),f"{piece}  a{a} e{e}"+(f"  ERR{errs}" if errs else ""),fill=(255,220,150))
im.save(out); print(out, im.size)
