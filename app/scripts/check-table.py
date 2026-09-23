import numpy as np, itertools, math

def Rx(a):
    c,s=math.cos(a),math.sin(a)
    return np.array([[1,0,0],[0,c,-s],[0,s,c]])
def Ry(a):
    c,s=math.cos(a),math.sin(a)
    return np.array([[c,0,s],[0,1,0],[-s,0,c]])
def Rz(a):
    c,s=math.cos(a),math.sin(a)
    return np.array([[c,-s,0],[s,c,0],[0,0,1]])
def euler(rx=0,ry=0,rz=0):
    # three.js default 'XYZ' order: R = Rx * Ry * Rz  (applied as R*v)
    return Rx(rx)@Ry(ry)@Rz(rz)

class Box:
    def __init__(self,name,size,C,R,kind='box'):
        self.name=name; self.h=np.array(size,float)/2
        self.C=np.array(C,float); self.R=np.array(R,float); self.kind=kind
    def corners(self):
        out=[]
        for sx,sy,sz in itertools.product((-1,1),repeat=3):
            out.append(self.C + self.R@(self.h*np.array([sx,sy,sz])))
        return np.array(out)

def child(parentC,parentR,localC,localR,size,name,kind='box'):
    R = parentR@localR
    C = parentC + parentR@np.array(localC,float)
    return Box(name,size,C,R,kind)

TILT=0.35; PIVOT_Y=0.880; PIVOT_Z=-0.180; FRAME_X=0.500; SPLAY=0.060
I=np.eye(3)
parts=[]

def span(f,t):
    dz=t[0]-f[0]; dy=t[1]-f[1]; L=math.hypot(dy,dz)
    return L, ((f[0]+t[0])/2,(f[1]+t[1])/2), math.atan2(dz/L, dy/L)

BR_L,BR_P,BR_R = span((-0.185,-0.472),(0.255,-0.190))
ST_L,ST_P,ST_R = span((0.231,0.612),(0.020,0.800))
SD = ((0.231-0.020)/ST_L, (0.612-0.800)/ST_L)

for sx in (-1,1):
    pC=np.array([sx*FRAME_X,PIVOT_Y,0.0]); pR=euler(0,0,sx*SPLAY)
    tag=f"[{'L' if sx<0 else 'R'}]"
    parts.append(child(pC,pR,[0,-0.440,-0.200],I,(0.058,0.880,0.052),f"back post {tag}"))
    parts.append(child(pC,pR,[0,-0.521,0.260],I,(0.058,0.718,0.052),f"front post {tag}"))
    parts.append(child(pC,pR,[0,-0.020,-0.200],I,(0.062,0.040,0.096),f"bearing block {tag}"))
    parts.append(child(pC,pR,[0,-0.006,-0.200],I,(0.070,0.026,0.038),f"bar strap {tag}"))
    parts.append(child(pC,pR,[0,BR_P[1],BR_P[0]],euler(BR_R,0,0),(0.040,BR_L,0.038),f"brace {tag}"))
    parts.append(child(pC,pR,[0,-0.855,0.030],I,(0.078,0.050,0.660),f"foot runner {tag}"))

parts.append(Box("pivot bar",(0.040,1.100,0.040),
                 np.array([-0.550,PIVOT_Y,PIVOT_Z])+euler(0,0,-math.pi/2)@np.array([0,0.550,0]),
                 euler(0,0,-math.pi/2),'cyl'))

bC=np.array([0,PIVOT_Y,PIVOT_Z]); bR=euler(TILT,0,0)
board = child(bC,bR,[0,0.034,0.140],I,(1.250,0.028,0.850),"BOARD")
parts.append(board)
for sx in (-1,1):
    parts.append(child(bC,bR,[sx*0.500,0.009,0.140],I,(0.060,0.022,0.800),
                       f"cleat [{'L' if sx<0 else 'R'}]"))
parts.append(child(bC,bR,[0.440,0.004,0.215],I,(0.032,0.040,0.028),"strut bracket"))
parts.append(child(bC,bR,[0,0.062,0.548],I,(1.250,0.030,0.032),"pencil ledge"))

parts.append(Box("rack bar",(0.090,0.030,0.470),[0.420,0.575,0.045],I))
for i in range(6):
    parts.append(Box(f"notch{i}",(0.028,0.020,0.020),[0.420,0.600,-0.120+i*0.078],I))
parts.append(Box("strut",(0.028,ST_L,0.024),[0.440,ST_P[1],ST_P[0]],euler(ST_R,0,0)))
parts.append(Box("strut shoe",(0.036,0.018,0.030),
                 [0.440,0.612+SD[1]*0.006,0.231+SD[0]*0.006],euler(ST_R,0,0)))

for i,z in enumerate((-0.190,0.280)):
    parts.append(Box(f"bearer{i}",(1.030,0.055,0.048),[0,0.300,z],I))
parts.append(Box("shelf",(0.980,0.020,0.460),[0,0.338,0.045],I))
rolls=[((-0.040,0.384,-0.006),0.0),((-0.100,0.384,0.066),0.0),((-0.055,0.446,0.030),0.0)]
for i,(p,yaw) in enumerate(rolls):
    parts.append(Box(f"roll{i}",(0.072,0.680,0.072),p,euler(0,yaw,math.pi/2),'cyl'))

# ===== 1. board-surface penetration =====
# board plane (top & bottom) in world; normal = bR @ (0,1,0)
n = bR@np.array([0,1,0])
top_pt  = bC + bR@np.array([0,0.034+0.014,0.140])
bot_pt  = bC + bR@np.array([0,0.034-0.014,0.140])
d_top = n@top_pt; d_bot = n@bot_pt
# lateral extent of the board slab in its own frame
ax = bR@np.array([1,0,0]); az = bR@np.array([0,0,1])
bx = ax@(bC+bR@np.array([0,0.034,0.140])); bz = az@(bC+bR@np.array([0,0.034,0.140]))

print("=== parts crossing the BOARD slab ===")
worst=[]
for p in parts:
    # the hinge bar and the strut bracket are let into the board on purpose
    if p.name in ("BOARD","strut bracket","pencil ledge","pivot bar") or p.name.startswith("cleat"): continue
    cs=p.corners()
    h = cs@n           # height along board normal
    u = cs@ax - bx
    v = cs@az - bz
    inside = (np.abs(u)<=0.625)&(np.abs(v)<=0.425)
    above = (h > d_bot+1e-9) & inside
    if above.any():
        pen = (h[above]-d_bot).max()
        worst.append((pen,p.name))
for pen,name in sorted(worst,reverse=True):
    print(f"  THROUGH  {name:<18} penetrates board underside by {pen*1000:6.1f} mm")
if not worst: print("  (none)")

print()
print("=== pairwise solid overlap (SAT, >3mm on every axis) ===")
def sat_pen(A,B):
    axes=[A.R[:,i] for i in range(3)]+[B.R[:,i] for i in range(3)]
    for i in range(3):
        for j in range(3):
            c=np.cross(A.R[:,i],B.R[:,j])
            if np.linalg.norm(c)>1e-6: axes.append(c/np.linalg.norm(c))
    minpen=1e9
    for a in axes:
        ra=sum(A.h[i]*abs(a@A.R[:,i]) for i in range(3))
        rb=sum(B.h[i]*abs(a@B.R[:,i]) for i in range(3))
        dist=abs(a@(B.C-A.C))
        pen=ra+rb-dist
        if pen<=0: return 0.0
        minpen=min(minpen,pen)
    return minpen

ignore_pairs={("back post","pivot bar"),("head rail","pivot bar")}
def base(n): return n.split(" [")[0]
res=[]
for A,B in itertools.combinations(parts,2):
    if base(A.name)==base(B.name): continue
    p=sat_pen(A,B)
    if p>0.003: res.append((p,A.name,B.name))
for p,a,b in sorted(res,reverse=True)[:40]:
    print(f"  {p*1000:6.1f} mm   {a:<18} ∩ {b}")
if not res: print("  (none)")

print()
print("=== floating parts (min y) ===")
for p in parts:
    ys=p.corners()[:,1]
    print(f"  {p.name:<18} y {ys.min():6.3f}..{ys.max():6.3f}   z {p.corners()[:,2].min():6.3f}..{p.corners()[:,2].max():6.3f}   x {p.corners()[:,0].min():6.3f}..{p.corners()[:,0].max():6.3f}")
