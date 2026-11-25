// Authentic MOS 6502 Assembly Demos for the Day 22 Commodore 64.
// Assembled at runtime by our 2-pass 6502 assembler and executed instruction-by-instruction
// on the emulated 6510 CPU!

function formatByteTable(name: string, values: number[]): string {
  const lines: string[] = [`${name}:`];
  for (let i = 0; i < values.length; i += 16) {
    const chunk = values
      .slice(i, i + 16)
      .map((v) => '$' + (v & 0xff).toString(16).toUpperCase().padStart(2, '0'))
      .join(',');
    lines.push(`  .BYTE ${chunk}`);
  }
  return lines.join('\n');
}

// 256-entry signed sine table with amplitude 40 (max 3-axis corner radius ~69 < 127)
const SIN_TABLE = Array.from({ length: 256 }, (_, i) => {
  const v = Math.round(Math.sin((i * Math.PI * 2) / 256) * 40);
  return v & 0xff;
});

// Perspective scale table indexed by signed Z + 128 (Z in [-69..+69]).
// Max projected radius = 69 * 165 / 128 = 89px -> Y in [11..189], X in [39..217].
const PERSP_TABLE = Array.from({ length: 256 }, (_, i) => {
  const z = i - 128;
  const d = 225;
  const s = Math.max(60, Math.min(212, Math.round((114 * d) / (d - z))));
  return s & 0xff;
});

// Precomputed C64 bitmap row addresses for y = 0..199 in VIC Bank 0 ($2000),
// centered horizontally by +32px (+32 bytes) so sx=0..255 maps to X=32..287 (Y = sx & $F8).
// XORing high byte with $40 switches instantaneously to VIC Bank 1 ($6000) for double buffering!
const ROW_ADDRS = Array.from({ length: 200 }, (_, y) => {
  const charRow = y >> 3;
  const fineY = y & 7;
  return 0x2000 + charRow * 320 + fineY + 32;
});
const ROW_LO_TABLE = ROW_ADDRS.map((a) => a & 0xff);
const ROW_HI_TABLE = ROW_ADDRS.map((a) => (a >> 8) & 0xff);

/**
 * CUBE3D — Double-Buffered 320x200 Hi-Res 3D Wireframe Cube + VIC-II Raster IRQ Bars + SID + TAC-2.
 */
export const CUBE3D_ASM_SOURCE = `; *** C64 6502 3D WIREFRAME CUBE ***
; DOUBLE-BUFFERED 320x200 BITMAP ($2000/$6000)
; VIC-II RASTER IRQ BARS + SID + TAC-2 JOYSTICK
; RUN: SYS 49152 ($C000)

* = $C000

; Zero-page workspace (main loop)
ZP_ANGY    = $02
ZP_ANGX    = $03
ZP_VELY    = $04
ZP_VELX    = $05
ZP_UX      = $06
ZP_UY      = $07
ZP_UZ      = $08
ZP_VY      = $09
ZP_VZ      = $0A
ZP_WX      = $0B
ZP_WY      = $0C
ZP_WZ      = $0D
ZP_RX      = $0E
ZP_RY      = $0F
ZP_RZ      = $10
ZP_SCALE   = $11
ZP_M1      = $12
ZP_M2      = $13
ZP_MLO     = $14
ZP_MHI     = $15
ZP_SIGN    = $16
ZP_HASPRV0 = $17
ZP_MODE    = $18   ; 1 = DRAW, 0 = ERASE
ZP_PAL     = $19
ZP_PAL_CHG = $1A
ZP_BACKPG  = $1B   ; 0 = drawing Bank 0 ($2000), 1 = drawing Bank 1 ($6000)
ZP_PG_XOR  = $1C   ; $00 for Bank 0, $40 for Bank 1
ZP_HASPRV1 = $1D
ZP_IDX     = $1E

; Zero-page Bresenham state (main loop)
ZP_X0      = $20
ZP_Y0      = $21
ZP_X1      = $22
ZP_Y1      = $23
ZP_DX      = $24
ZP_DY      = $25
ZP_SX      = $26
ZP_SY      = $27
ZP_ERR     = $28
ZP_CNT     = $29
ZP_PTR_LO  = $2A
ZP_PTR_HI  = $2B

; Projected 2D vertices (current + per-page previous for double-buffered differential erase!)
CUR_X      = $30   ; $30..$37
CUR_Y      = $38   ; $38..$3F
PREV0_X    = $40   ; $40..$47 (last frame drawn on Bank 0)
PREV0_Y    = $48   ; $48..$4F
PREV1_X    = $60   ; $60..$67 (last frame drawn on Bank 1)
PREV1_Y    = $68   ; $68..$6F

; Zero-page IRQ-only workspace (isolated from main loop!)
IRQ_PHASE  = $50
IRQ_FIRE   = $51
IRQ_BEAT   = $52
IRQ_NOTE   = $53
IRQ_TMP    = $54

; Hardware registers
IRQ_VEC_LO = $FFFE
IRQ_VEC_HI = $FFFF
VIC_D011   = $D011
VIC_RAST   = $D012
VIC_D016   = $D016
VIC_D018   = $D018
VIC_IRQ_ST = $D019
VIC_IRQ_EN = $D01A
VIC_BDR    = $D020
VIC_BG     = $D021
SID_FH     = $D401
SID_CTRL   = $D404
SID_AD     = $D405
SID_SR     = $D406
SID_VOL    = $D418
CIA_JOY2   = $DC00
CIA2_BANK  = $DD00

START:
  SEI
  LDA #$00
  STA VIC_BDR
  STA VIC_BG
  STA ZP_ANGY
  STA ZP_ANGX
  STA ZP_HASPRV0
  STA ZP_HASPRV1
  STA ZP_PAL
  STA ZP_PAL_CHG
  STA ZP_BACKPG
  STA ZP_PG_XOR
  STA IRQ_PHASE
  STA IRQ_FIRE
  STA IRQ_BEAT
  STA IRQ_NOTE
  LDA #$04
  STA ZP_VELY
  LDA #$02
  STA ZP_VELX

  ; Clear Bank 0 bitmap ($2000-$3FFF) and Bank 1 bitmap ($6000-$7FFF)
  LDA #$20
  JSR CLEAR_8KB
  LDA #$60
  JSR CLEAR_8KB

  ; Paint neon gradient color matrices in BOTH Bank 0 ($0400) & Bank 1 ($4400)
  JSR APPLY_PALETTE

  ; Show Bank 0 initially ($DD00 = $03 -> $0000-$3FFF), draw first frame to Bank 1 ($6000)
  LDA #$03
  STA CIA2_BANK
  LDA #$01
  STA ZP_BACKPG
  LDA #$40
  STA ZP_PG_XOR

  ; Switch VIC-II to 320x200 Hi-Res Bitmap mode
  LDA #$3B
  STA VIC_D011
  LDA #$08
  STA VIC_D016
  LDA #$18
  STA VIC_D018

  ; Initialize SID Voice 1 (triangle synth bass pulse)
  LDA #$0C
  STA SID_VOL
  LDA #$04
  STA SID_AD
  LDA #$00
  STA SID_SR

  ; Install VIC-II Raster IRQ handler at $0314/$0315 for rock-solid top & bottom raster bars
  LDA #<RASTER_IRQ
  STA IRQ_VEC_LO
  LDA #>RASTER_IRQ
  STA IRQ_VEC_HI
  LDA #28
  STA VIC_RAST
  LDA #$01
  STA VIC_IRQ_ST
  STA VIC_IRQ_EN
  CLI

; ---- MAIN DOUBLE-BUFFERED 3D VECTOR LOOP ----
MAIN_LOOP:
  ; Apply palette change requested by TAC-2 Fire button
  LDA ZP_PAL_CHG
  BEQ NO_PAL_UPD
  LDA #$00
  STA ZP_PAL_CHG
  JSR APPLY_PALETTE
NO_PAL_UPD:

  ; Compute 3D rotated & perspective-projected vertices into CUR_X / CUR_Y
  JSR COMPUTE_CUBE

  ; Erase only the old edges on the HIDDEN back buffer (zero visible tearing!)
  LDA ZP_BACKPG
  BNE ERASE_PG1

  LDA ZP_HASPRV0
  BEQ DRAW_NEW
  LDA #$00
  STA ZP_MODE
  JSR DRAW_EDGES_PREV0
  JMP DRAW_NEW

ERASE_PG1:
  LDA ZP_HASPRV1
  BEQ DRAW_NEW
  LDA #$00
  STA ZP_MODE
  JSR DRAW_EDGES_PREV1

DRAW_NEW:
  ; Draw all 12 fresh wireframe edges onto the HIDDEN back buffer
  LDA #$01
  STA ZP_MODE
  JSR DRAW_EDGES_CUR

  ; Save CUR_X/Y into this back buffer's PREV table & flip VIC-II bank atomically!
  LDA ZP_BACKPG
  BNE FINISH_PG1

  ; Back buffer was Bank 0 ($2000): save PREV0, show Bank 0 ($DD00=$03), next draw Bank 1
  LDX #$07
CPY_P0:
  LDA CUR_X,X
  STA PREV0_X,X
  LDA CUR_Y,X
  STA PREV0_Y,X
  DEX
  BPL CPY_P0
  LDA #$01
  STA ZP_HASPRV0
  LDA #$03
  STA CIA2_BANK     ; Atomic page flip -> display Bank 0 ($2000)
  LDA #$01
  STA ZP_BACKPG
  LDA #$40
  STA ZP_PG_XOR
  JMP ADVANCE_ANGLES

FINISH_PG1:
  ; Back buffer was Bank 1 ($6000): save PREV1, show Bank 1 ($DD00=$02), next draw Bank 0
  LDX #$07
CPY_P1:
  LDA CUR_X,X
  STA PREV1_X,X
  LDA CUR_Y,X
  STA PREV1_Y,X
  DEX
  BPL CPY_P1
  LDA #$01
  STA ZP_HASPRV1
  LDA #$02
  STA CIA2_BANK     ; Atomic page flip -> display Bank 1 ($6000)
  LDA #$00
  STA ZP_BACKPG
  STA ZP_PG_XOR

ADVANCE_ANGLES:
  CLC
  LDA ZP_ANGY
  ADC ZP_VELY
  STA ZP_ANGY
  CLC
  LDA ZP_ANGX
  ADC ZP_VELX
  STA ZP_ANGX

  JMP MAIN_LOOP

; Clear 8KB starting at page A ($20 or $60)
CLEAR_8KB:
  STA ZP_PTR_HI
  LDA #$00
  STA ZP_PTR_LO
  LDX #$20
CLR_PG_LP:
  LDY #$00
  LDA #$00
CLR_BT_LP:
  STA (ZP_PTR_LO),Y
  INY
  BNE CLR_BT_LP
  INC ZP_PTR_HI
  DEX
  BNE CLR_PG_LP
  RTS

; ---- VIC-II RASTER IRQ HANDLER (60HZ TOP & BOTTOM RASTER BARS + JOY + SID) ----
RASTER_IRQ:
  PHA
  TXA
  PHA
  TYA
  PHA

  LDA #$01
  STA VIC_IRQ_ST

  ; Paint 16-scanline classic C64 raster bar across border
  LDX #$00
IRQ_BAR_LP:
  LDA RASTER_BAR,X
  STA VIC_BDR
  LDA VIC_RAST
IRQ_WAIT_LN:
  CMP VIC_RAST
  BEQ IRQ_WAIT_LN
  INX
  CPX #16
  BNE IRQ_BAR_LP
  LDA #$00
  STA VIC_BDR

  ; Toggle top bar (line 28) vs bottom bar (line 254)
  LDA IRQ_PHASE
  BNE IRQ_WAS_BOT
  LDA #$01
  STA IRQ_PHASE
  LDA #254
  STA VIC_RAST
  JMP IRQ_EXIT

IRQ_WAS_BOT:
  LDA #$00
  STA IRQ_PHASE
  LDA #28
  STA VIC_RAST

  ; Poll Suncom TAC-2 Joystick ($DC00, active-low)
  LDA CIA_JOY2
  STA IRQ_TMP
  AND #$04        ; Left
  BNE IRQ_CHK_R
  LDA #$FA        ; -6
  STA ZP_VELY
  JMP IRQ_CHK_U
IRQ_CHK_R:
  LDA IRQ_TMP
  AND #$08        ; Right
  BNE IRQ_CHK_U
  LDA #$06        ; +6
  STA ZP_VELY
IRQ_CHK_U:
  LDA IRQ_TMP
  AND #$01        ; Up
  BNE IRQ_CHK_D
  LDA #$FB        ; -5
  STA ZP_VELX
  JMP IRQ_CHK_F
IRQ_CHK_D:
  LDA IRQ_TMP
  AND #$02        ; Down
  BNE IRQ_CHK_F
  LDA #$05        ; +5
  STA ZP_VELX
IRQ_CHK_F:
  LDA IRQ_TMP
  AND #$10        ; Fire
  BNE IRQ_FIRE_UP
  LDA IRQ_FIRE
  BNE IRQ_DO_SID
  LDA #$01
  STA IRQ_FIRE
  INC ZP_PAL
  LDA ZP_PAL
  CMP #$03
  BCC IRQ_PAL_OK
  LDA #$00
  STA ZP_PAL
IRQ_PAL_OK:
  LDA #$01
  STA ZP_PAL_CHG
  LDA #$04
  STA ZP_VELY
  LDA #$02
  STA ZP_VELX
  JMP IRQ_DO_SID
IRQ_FIRE_UP:
  LDA #$00
  STA IRQ_FIRE

  ; SID Voice 1 arpeggio every 14 frames
IRQ_DO_SID:
  INC IRQ_BEAT
  LDA IRQ_BEAT
  CMP #14
  BCC IRQ_EXIT
  LDA #$00
  STA IRQ_BEAT
  LDX IRQ_NOTE
  LDA #$10
  STA SID_CTRL
  LDA SID_NOTES,X
  STA SID_FH
  LDA #$11
  STA SID_CTRL
  INX
  TXA
  AND #$07
  STA IRQ_NOTE

IRQ_EXIT:
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI

; ---- PAINT NEON COLOR MATRICES ($0400-$07E7 AND $4400-$47E7) ----
APPLY_PALETTE:
  LDA #$04
  JSR FILL_PAL_AT
  LDA #$44
  JSR FILL_PAL_AT
  RTS

FILL_PAL_AT:
  STA ZP_PTR_HI
  LDA #$00
  STA ZP_PTR_LO
  LDA ZP_PAL
  ASL A
  ASL A
  ASL A
  TAX
  LDA #$05
  STA ZP_CNT
BAND_LP:
  LDA PAL_BANDS,X
  INX
  LDY #199
CELL_LP:
  STA (ZP_PTR_LO),Y
  DEY
  CPY #$FF
  BNE CELL_LP
  CLC
  LDA ZP_PTR_LO
  ADC #200
  STA ZP_PTR_LO
  BCC BAND_NO_INC
  INC ZP_PTR_HI
BAND_NO_INC:
  DEC ZP_CNT
  BNE BAND_LP
  RTS

; ---- COMPUTE 3D BASIS VECTORS (PRODUCT-TO-SUM, ZERO MULTIPLIES!) ----
COMPUTE_CUBE:
  LDA ZP_ANGY
  TAX
  LDA SIN_TBL,X
  EOR #$FF
  CLC
  ADC #$01
  STA ZP_WX
  TXA
  CLC
  ADC #64
  TAX
  LDA SIN_TBL,X
  STA ZP_UX

  LDA ZP_ANGX
  TAX
  LDA SIN_TBL,X
  STA ZP_VZ
  TXA
  CLC
  ADC #64
  TAX
  LDA SIN_TBL,X
  STA ZP_VY

  CLC
  LDA ZP_ANGY
  ADC ZP_ANGX
  TAX
  SEC
  LDA ZP_ANGY
  SBC ZP_ANGX
  TAY

  CLC
  LDA SIN_TBL,X
  ADC SIN_TBL,Y
  JSR ASR_A
  STA ZP_UZ

  SEC
  LDA SIN_TBL,Y
  SBC SIN_TBL,X
  JSR ASR_A
  STA ZP_WY

  TXA
  CLC
  ADC #64
  TAX
  TYA
  CLC
  ADC #64
  TAY

  SEC
  LDA SIN_TBL,X
  SBC SIN_TBL,Y
  JSR ASR_A
  STA ZP_UY

  CLC
  LDA SIN_TBL,Y
  ADC SIN_TBL,X
  JSR ASR_A
  STA ZP_WZ

  LDX #$00
VERT_LP:
  STX ZP_IDX

  TXA
  AND #$01
  BNE V_POS_X
  LDA ZP_UX
  JSR NEG_A
  STA ZP_RX
  LDA ZP_UY
  JSR NEG_A
  STA ZP_RY
  LDA ZP_UZ
  JSR NEG_A
  STA ZP_RZ
  JMP V_ADD_Y
V_POS_X:
  LDA ZP_UX
  STA ZP_RX
  LDA ZP_UY
  STA ZP_RY
  LDA ZP_UZ
  STA ZP_RZ

V_ADD_Y:
  LDA ZP_IDX
  AND #$02
  BNE V_POS_Y
  SEC
  LDA ZP_RY
  SBC ZP_VY
  STA ZP_RY
  SEC
  LDA ZP_RZ
  SBC ZP_VZ
  STA ZP_RZ
  JMP V_ADD_Z
V_POS_Y:
  CLC
  LDA ZP_RY
  ADC ZP_VY
  STA ZP_RY
  CLC
  LDA ZP_RZ
  ADC ZP_VZ
  STA ZP_RZ

V_ADD_Z:
  LDA ZP_IDX
  AND #$04
  BNE V_POS_Z
  SEC
  LDA ZP_RX
  SBC ZP_WX
  STA ZP_RX
  SEC
  LDA ZP_RY
  SBC ZP_WY
  STA ZP_RY
  SEC
  LDA ZP_RZ
  SBC ZP_WZ
  STA ZP_RZ
  JMP V_PROJECT
V_POS_Z:
  CLC
  LDA ZP_RX
  ADC ZP_WX
  STA ZP_RX
  CLC
  LDA ZP_RY
  ADC ZP_WY
  STA ZP_RY
  CLC
  LDA ZP_RZ
  ADC ZP_WZ
  STA ZP_RZ

V_PROJECT:
  LDA ZP_RZ
  EOR #$80
  TAY
  LDA PERSP_TBL,Y
  STA ZP_SCALE

  LDA ZP_RX
  JSR MUL_S8_U8_HI
  CLC
  ADC #128
  LDX ZP_IDX
  STA CUR_X,X

  LDA ZP_RY
  JSR MUL_S8_U8_HI
  CLC
  ADC #100
  LDX ZP_IDX
  STA CUR_Y,X

  INX
  CPX #$08
  BEQ VERT_DONE
  JMP VERT_LP
VERT_DONE:
  RTS

ASR_A:
  CMP #$80
  ROR A
  RTS

NEG_A:
  EOR #$FF
  CLC
  ADC #$01
  RTS

MUL_S8_U8_HI:
  STA ZP_M1
  LDA #$00
  STA ZP_SIGN
  LDA ZP_M1
  BPL MUL_POS
  JSR NEG_A
  STA ZP_M1
  LDA #$01
  STA ZP_SIGN
MUL_POS:
  LDA ZP_SCALE
  STA ZP_M2
  LDA #$00
  STA ZP_MHI
  LDY #$08
MUL_LP:
  LSR ZP_M1
  BCC MUL_NO_ADD
  CLC
  LDA ZP_MHI
  ADC ZP_M2
  STA ZP_MHI
MUL_NO_ADD:
  ROR ZP_MHI
  ROR ZP_MLO
  DEY
  BNE MUL_LP
  ASL ZP_MLO
  ROL ZP_MHI
  LDA ZP_MHI
  LDY ZP_SIGN
  BEQ MUL_DONE
  JSR NEG_A
MUL_DONE:
  RTS

; ---- DRAW ALL 12 EDGES ----
DRAW_EDGES_CUR:
  LDX #$00
EC_LP:
  STX ZP_IDX
  LDY EDGE_A,X
  LDA CUR_X,Y
  STA ZP_X0
  LDA CUR_Y,Y
  STA ZP_Y0
  LDY EDGE_B,X
  LDA CUR_X,Y
  STA ZP_X1
  LDA CUR_Y,Y
  STA ZP_Y1
  JSR DRAW_LINE
  LDX ZP_IDX
  INX
  CPX #12
  BNE EC_LP
  RTS

DRAW_EDGES_PREV0:
  LDX #$00
EP0_LP:
  STX ZP_IDX
  LDY EDGE_A,X
  LDA PREV0_X,Y
  STA ZP_X0
  LDA PREV0_Y,Y
  STA ZP_Y0
  LDY EDGE_B,X
  LDA PREV0_X,Y
  STA ZP_X1
  LDA PREV0_Y,Y
  STA ZP_Y1
  JSR DRAW_LINE
  LDX ZP_IDX
  INX
  CPX #12
  BNE EP0_LP
  RTS

DRAW_EDGES_PREV1:
  LDX #$00
EP1_LP:
  STX ZP_IDX
  LDY EDGE_A,X
  LDA PREV1_X,Y
  STA ZP_X0
  LDA PREV1_Y,Y
  STA ZP_Y0
  LDY EDGE_B,X
  LDA PREV1_X,Y
  STA ZP_X1
  LDA PREV1_Y,Y
  STA ZP_Y1
  JSR DRAW_LINE
  LDX ZP_IDX
  INX
  CPX #12
  BNE EP1_LP
  RTS

; ---- FAST 8-BIT DOUBLE-BUFFERED BRESENHAM LINE ----
DRAW_LINE:
  LDA ZP_X1
  SEC
  SBC ZP_X0
  BCS DX_POS
  EOR #$FF
  CLC
  ADC #$01
  STA ZP_DX
  LDA #$FF
  STA ZP_SX
  JMP DO_DY
DX_POS:
  STA ZP_DX
  LDA #$01
  STA ZP_SX

DO_DY:
  LDA ZP_Y1
  SEC
  SBC ZP_Y0
  BCS DY_POS
  EOR #$FF
  CLC
  ADC #$01
  STA ZP_DY
  LDA #$FF
  STA ZP_SY
  JMP CHK_MAJOR
DY_POS:
  STA ZP_DY
  LDA #$01
  STA ZP_SY

CHK_MAJOR:
  LDA ZP_DX
  CMP ZP_DY
  BCC Y_MAJOR

; ---- X-MAJOR BRESENHAM ----
X_MAJOR:
  LDA ZP_DX
  STA ZP_CNT
  LSR A
  STA ZP_ERR
  LDY ZP_Y0
  LDA ROW_LO,Y
  STA ZP_PTR_LO
  LDA ROW_HI,Y
  EOR ZP_PG_XOR
  STA ZP_PTR_HI
XM_LP:
  LDA ZP_X0
  AND #$F8
  TAY
  LDA ZP_X0
  AND #$07
  TAX
  LDA ZP_MODE
  BEQ XM_CLR
  LDA (ZP_PTR_LO),Y
  ORA BIT_MASK,X
  STA (ZP_PTR_LO),Y
  JMP XM_STEP
XM_CLR:
  LDA (ZP_PTR_LO),Y
  AND INV_MASK,X
  STA (ZP_PTR_LO),Y
XM_STEP:
  LDA ZP_CNT
  BNE XM_CONT
  RTS
XM_CONT:
  DEC ZP_CNT
  CLC
  LDA ZP_X0
  ADC ZP_SX
  STA ZP_X0
  SEC
  LDA ZP_ERR
  SBC ZP_DY
  BCS XM_NO_Y
  CLC
  ADC ZP_DX
  STA ZP_ERR
  CLC
  LDA ZP_Y0
  ADC ZP_SY
  STA ZP_Y0
  TAY
  LDA ROW_LO,Y
  STA ZP_PTR_LO
  LDA ROW_HI,Y
  EOR ZP_PG_XOR
  STA ZP_PTR_HI
  JMP XM_LP
XM_NO_Y:
  STA ZP_ERR
  JMP XM_LP

; ---- Y-MAJOR BRESENHAM ----
Y_MAJOR:
  LDA ZP_DY
  STA ZP_CNT
  LSR A
  STA ZP_ERR
YM_LP:
  LDY ZP_Y0
  LDA ROW_LO,Y
  STA ZP_PTR_LO
  LDA ROW_HI,Y
  EOR ZP_PG_XOR
  STA ZP_PTR_HI
  LDA ZP_X0
  AND #$F8
  TAY
  LDA ZP_X0
  AND #$07
  TAX
  LDA ZP_MODE
  BEQ YM_CLR
  LDA (ZP_PTR_LO),Y
  ORA BIT_MASK,X
  STA (ZP_PTR_LO),Y
  JMP YM_STEP
YM_CLR:
  LDA (ZP_PTR_LO),Y
  AND INV_MASK,X
  STA (ZP_PTR_LO),Y
YM_STEP:
  LDA ZP_CNT
  BEQ LINE_DONE
  DEC ZP_CNT
  CLC
  LDA ZP_Y0
  ADC ZP_SY
  STA ZP_Y0
  SEC
  LDA ZP_ERR
  SBC ZP_DX
  BCS YM_NO_X
  CLC
  ADC ZP_DY
  STA ZP_ERR
  CLC
  LDA ZP_X0
  ADC ZP_SX
  STA ZP_X0
  JMP YM_LP
YM_NO_X:
  STA ZP_ERR
  JMP YM_LP

LINE_DONE:
  RTS

; ---- TABLES ----
EDGE_A:
  .BYTE 0,1,3,2, 4,5,7,6, 0,1,2,3
EDGE_B:
  .BYTE 1,3,2,0, 5,7,6,4, 4,5,6,7

BIT_MASK:
  .BYTE $80,$40,$20,$10,$08,$04,$02,$01
INV_MASK:
  .BYTE $7F,$BF,$DF,$EF,$F7,$FB,$FD,$FE

RASTER_BAR:
  .BYTE $06,$06,$0E,$0E,$03,$03,$01,$01,$01,$03,$03,$0E,$0E,$06,$06,$00

PAL_BANDS:
  .BYTE $E0,$30,$10,$30,$E0, $00,$00,$00
  .BYTE $50,$D0,$70,$D0,$50, $00,$00,$00
  .BYTE $40,$A0,$70,$A0,$40, $00,$00,$00

SID_NOTES:
  .BYTE 14,18,21,28,21,18,16,21

${formatByteTable('SIN_TBL', SIN_TABLE)}

${formatByteTable('PERSP_TBL', PERSP_TABLE)}

${formatByteTable('ROW_LO', ROW_LO_TABLE)}

${formatByteTable('ROW_HI', ROW_HI_TABLE)}
`;

/**
 * RASTER — Short, classic 6502 Assembly Raster Bars demo (great starter template to inspect/disassemble!).
 */
export const RASTER_ASM_SOURCE = `; *** C64 6502 RASTER BARS ***
; CLASSIC DEMOSCENE BORDER COPPER BARS

* = $C000

CHROUT = $FFD2
CLRSCR = $E544

START:
  JSR CLRSCR
  LDA #$00
  STA $D020
  STA $D021
  LDX #$00
PRINT_LP:
  LDA MSG,X
  BEQ LOOP
  JSR CHROUT
  INX
  BNE PRINT_LP

LOOP:
  LDA $D012
  CMP #110
  BNE LOOP
  LDX #$00
BAR_LP:
  LDA COLORS,X
  STA $D020
  STA $D021
  LDA $D012
WAIT_LN:
  CMP $D012
  BEQ WAIT_LN
  INX
  CPX #24
  BNE BAR_LP
  LDA #$00
  STA $D020
  STA $D021
  JMP LOOP

COLORS:
  .BYTE $06,$06,$0E,$0E,$03,$03,$01,$01
  .BYTE $07,$07,$08,$08,$0A,$0A,$02,$02
  .BYTE $04,$04,$06,$06,$0E,$0E,$03,$00

MSG:
  .BYTE 13,"   *** 6502 ASSEMBLY RASTER BARS ***",13
  .BYTE "   RUNNING AT $C000 (ESC TO BREAK)",13,0
`;
