; ============================================================================
;   CODEVEMBER 2026 — "TTB" (YET ANOTHER C64 CRACK INTRO)
;   BY TTB & GEMINI 4 NEON
; ============================================================================
;   100% Pure MOS 6502/6510 Assembly for the Day 22 Commodore 64 Emulator
;
;   HOW TO RUN:
;     1. Copy this entire file and paste (Cmd+V / Ctrl+V) onto the C64 screen
;     2. Type: SYS 32768
;     (Or on the 1541 disk: LOAD "INTRO",8  then  RUN)
;
;   CONTROLS:
;     Arrows / WASD / TAC-2  -> Steer 3D wireframe cube spin
;     Space / Fire Button    -> Cycle neon vector palettes
;     Esc (RUN/STOP)         -> Break cleanly back to BASIC READY.
;
;   MEMORY MAP:
;     $0400-$07E7  Bank 0 Screen Matrix (Logo colors + Credits + Scroller + Cube colors)
;     $2000-$3F3F  Bank 0 Bitmap (Chrome CODEVEMBER logo + Cube/Stars Page 0)
;     $4400-$47E7  Bank 1 Screen Matrix (Cube/Stars colors)
;     $6000-$7F3F  Bank 1 Bitmap (Cube/Stars Page 1 - hardware double buffer)
;     $8000-$96FF  Cracktro 6502 code, 3-voice SID music, tables & chrome logo data
;
;   FEATURES:
;     * Giant sculpted 3D-beveled chrome "CODEVEMBER" bitmap logo + stripes
;     * VIC-II 5-way Raster IRQ split-screen (Bitmap / Text / Bitmap / Scroll)
;     * Animated copper/gold color-wash credits (DRAGON / FRONTIERS vibes)
;     * 3-layer parallax starfield + double-buffered 3D wireframe cube ($2000/$6000)
;     * Smooth 60 FPS 38-col hardware fine-scrolled cracktro scroller ($D016)
;     * Animated multi-color raster copper floor + top border raster bar
;     * 3-Voice 6581 SID Chiptune (Pulse Lead + Octave Saw Bass + Arp/Noise Drums)
; ============================================================================

* = $8000

; ---- Zero-Page Workspace (Main 3D + Parallax Loop) ----
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
ZP_MODE    = $18
ZP_PAL     = $19
ZP_PAL_CHG = $1A
ZP_BACKPG  = $1B
ZP_PG_XOR  = $1C
ZP_HASPRV1 = $1D
ZP_IDX     = $1E
ZP_SHOWBNK = $1F   ; $03 = Bank 0 ($2000), $02 = Bank 1 ($6000)

; Bresenham line state
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
ZP_SRC_LO  = $2C
ZP_SRC_HI  = $2D

; Projected 2D cube vertices (current + per-page previous)
CUR_X      = $30   ; $30..$37
CUR_Y      = $38   ; $38..$3F
PREV0_X    = $40   ; $40..$47
PREV0_Y    = $48   ; $48..$4F
PREV1_X    = $60   ; $60..$67
PREV1_Y    = $68   ; $68..$6F

; ---- Zero-Page Workspace (IRQ-only — completely isolated from Main Loop!) ----
IRQ_STATE  = $50   ; 0=Top, 1=Credits, 2=Cube, 3=Scroller, 4=Footer+Floor+SID
IRQ_TMP    = $51
IRQ_FIRE   = $52
ZP_SCRX    = $53   ; Hardware fine X-scroll 0..7
ZP_MSG_LO  = $54
ZP_MSG_HI  = $55
ZP_WASH    = $56   ; Color-wash animation phase
ZP_FLOOR   = $57   ; Bottom copper floor roll phase
ZP_FRAME   = $58   ; Frame counter
SID_TICK   = $59   ; Music sub-step tick (0..10 -> ~88 BPM vaporwave!)
SID_STEP   = $5A   ; Song step (0..63)
SID_ARP    = $5B   ; Slow cascading 4-note chord arpeggio phase (0..3)
SID_CHORD  = $5C   ; Current chord index * 4
SID_SNARE  = $5D   ; Non-zero while soft snare owns Voice 3
SID_ARPTK  = $5E   ; Arpeggio divider (steps every 6 frames -> dreamy harp!)
SID_VIB    = $5F   ; VHS tape-warble LFO phase (0..31)
SID_L1_LO  = $70   ; Base Voice 1 freq lo (for smooth tape-warble vibrato)
SID_L1_HI  = $71   ; Base Voice 1 freq hi

; Parallax star RAM arrays (page $02)
STAR_X     = $0200 ; 18 bytes: current X
STAR_O0    = $0220 ; 18 bytes: previous X drawn on Bank 0
STAR_O1    = $0240 ; 18 bytes: previous X drawn on Bank 1

; ---- Hardware Registers ----
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
SID_V1_FL  = $D400
SID_V1_FH  = $D401
SID_V1_CR  = $D404
SID_V1_AD  = $D405
SID_V1_SR  = $D406
SID_V2_FL  = $D407
SID_V2_FH  = $D408
SID_V2_CR  = $D40B
SID_V2_AD  = $D40C
SID_V2_SR  = $D40D
SID_V3_FL  = $D40E
SID_V3_FH  = $D40F
SID_V3_CR  = $D412
SID_V3_AD  = $D413
SID_V3_SR  = $D414
SID_VOL    = $D418
CIA_JOY2   = $DC00
CIA2_BANK  = $DD00

; ============================================================================
;   INITIALIZATION
; ============================================================================
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
  STA IRQ_STATE
  STA IRQ_FIRE
  STA ZP_WASH
  STA ZP_FLOOR
  STA ZP_FRAME
  STA SID_TICK
  STA SID_STEP
  STA SID_ARP
  STA SID_CHORD
  STA SID_SNARE
  STA SID_ARPTK
  STA SID_VIB
  STA SID_L1_LO
  STA SID_L1_HI

  LDA #$07
  STA ZP_SCRX
  LDA #$03
  STA ZP_VELY
  LDA #$02
  STA ZP_VELX

  ; Reset scrolltext pointer
  LDA #<SCROLL_DATA
  STA ZP_MSG_LO
  LDA #>SCROLL_DATA
  STA ZP_MSG_HI

  ; Clear Bank 0 ($2000-$3FFF) and Bank 1 ($6000-$7FFF) bitmaps
  LDA #$20
  JSR CLEAR_8KB
  LDA #$60
  JSR CLEAR_8KB

  ; Copy sculpted chrome "CODEVEMBER" bitmap logo (1600 bytes) into Bank 0 ($2000)
  JSR COPY_LOGO

  ; Setup Bank 0 & Bank 1 color matrices + Text Mode credits, scroller & footer
  JSR INIT_SCREEN_LAYOUT

  ; Initialize 18 parallax stars across 3 depth layers
  LDX #17
INIT_STARS:
  LDA STAR_INIT_X_TBL,X
  STA STAR_X,X
  STA STAR_O0,X
  STA STAR_O1,X
  DEX
  BPL INIT_STARS

  ; Show Bank 0 initially, draw first cube/star frame onto hidden Bank 1 ($6000)
  LDA #$03
  STA ZP_SHOWBNK
  STA CIA2_BANK
  LDA #$01
  STA ZP_BACKPG
  LDA #$40
  STA ZP_PG_XOR

  ; Switch VIC-II to Hi-Res Bitmap mode at top of screen
  LDA #$3B
  STA VIC_D011
  LDA #$08
  STA VIC_D016
  LDA #$18
  STA VIC_D018

  ; Initialize 3-Voice 6581 SID Synth (Warm Nostalgic Vaporwave Patch!)
  LDA #$0D
  STA SID_VOL
  ; Voice 1: Dreamy Bloom Triangle Lead (soft attack, lush sustain & long release)
  LDA #$2A
  STA SID_V1_AD
  LDA #$89
  STA SID_V1_SR
  ; Voice 2: Deep Warm Analog Vaporwave Bass (gentle sustain)
  LDA #$19
  STA SID_V2_AD
  LDA #$78
  STA SID_V2_SR
  ; Voice 3: Shimmering Maj7/Min9 Harp Pad & Soft Brushed Snare
  LDA #$18
  STA SID_V3_AD
  LDA #$47
  STA SID_V3_SR

  ; Install 5-Stage VIC-II Raster IRQ Multiplexer at $0314/$0315
  LDA #<RASTER_IRQ
  STA IRQ_VEC_LO
  LDA #>RASTER_IRQ
  STA IRQ_VEC_HI
  LDA #18
  STA VIC_RAST
  LDA #$01
  STA VIC_IRQ_ST
  STA VIC_IRQ_EN
  CLI

; ============================================================================
;   MAIN LOOP — DOUBLE-BUFFERED 3D WIREFRAME CUBE + 3-LAYER PARALLAX STARS
; ============================================================================
MAIN_LOOP:
  LDA ZP_PAL_CHG
  BEQ NO_PAL_UPD
  LDA #$00
  STA ZP_PAL_CHG
  JSR PAINT_ARENA_PALETTE
NO_PAL_UPD:

  ; 1. Compute rotated & perspective-projected 3D cube vertices
  JSR COMPUTE_CUBE

  ; 2. Erase previous cube edges & previous stars on the HIDDEN back buffer
  LDA ZP_BACKPG
  BNE ERASE_PG1

  JSR ERASE_STARS_PG0
  LDA ZP_HASPRV0
  BEQ DRAW_STAGE
  LDA #$00
  STA ZP_MODE
  JSR DRAW_EDGES_PREV0
  JMP DRAW_STAGE

ERASE_PG1:
  JSR ERASE_STARS_PG1
  LDA ZP_HASPRV1
  BEQ DRAW_STAGE
  LDA #$00
  STA ZP_MODE
  JSR DRAW_EDGES_PREV1

DRAW_STAGE:
  ; 3. Advance & draw 3-layer parallax starfield onto hidden back buffer
  JSR UPDATE_AND_DRAW_STARS

  ; 4. Draw all 12 fresh 3D wireframe cube edges onto hidden back buffer
  LDA #$01
  STA ZP_MODE
  JSR DRAW_EDGES_CUR

  ; 5. Save per-page PREV vertices and atomically flip ZP_SHOWBNK!
  LDA ZP_BACKPG
  BNE FINISH_PG1

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
  STA ZP_SHOWBNK    ; Atomic double-buffer swap -> show Bank 0 ($2000)
  LDA #$01
  STA ZP_BACKPG
  LDA #$40
  STA ZP_PG_XOR
  JMP ADVANCE_CUBE

FINISH_PG1:
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
  STA ZP_SHOWBNK    ; Atomic double-buffer swap -> show Bank 1 ($6000)
  LDA #$00
  STA ZP_BACKPG
  STA ZP_PG_XOR

ADVANCE_CUBE:
  CLC
  LDA ZP_ANGY
  ADC ZP_VELY
  STA ZP_ANGY
  CLC
  LDA ZP_ANGX
  ADC ZP_VELX
  STA ZP_ANGX

  JMP MAIN_LOOP

; ============================================================================
;   5-STAGE VIC-II RASTER IRQ MULTIPLEXER (60 HZ)
; ============================================================================
RASTER_IRQ:
  PHA
  TXA
  PHA
  TYA
  PHA

  LDA #$01
  STA VIC_IRQ_ST

  LDA IRQ_STATE
  BEQ STAGE0_TOP
  CMP #$01
  BEQ STAGE1_CREDITS
  CMP #$02
  BEQ STAGE2_CUBE
  CMP #$03
  BNE GO_STAGE4
  JMP STAGE3_SCROLL
GO_STAGE4:
  JMP STAGE4_FLOOR_AND_ENGINE

; ---- STAGE 0 (Line 18): Top Copper Bar + Chrome CODEVEMBER Logo (Bitmap Bank 0) ----
STAGE0_TOP:
  LDX #$00
TOP_BAR_LP:
  LDA TOP_RASTER_BAR,X
  STA VIC_BDR
  LDA VIC_RAST
TOP_WAIT_LN:
  CMP VIC_RAST
  BEQ TOP_WAIT_LN
  INX
  CPX #12
  BNE TOP_BAR_LP
  LDA #$00
  STA VIC_BDR
  STA VIC_BG

  ; Show Chrome Logo in Bank 0 Hi-Res Bitmap
  LDA #$03
  STA CIA2_BANK
  LDA #$3B
  STA VIC_D011
  LDA #$08
  STA VIC_D016
  LDA #$18
  STA VIC_D018

  LDA #$01
  STA IRQ_STATE
  LDA #90           ; Row 5 (y=40)
  STA VIC_RAST
  JMP IRQ_DONE

; ---- STAGE 1 (Line 90): Switch to Text Mode for Color-Wash Credits (Rows 5-6) ----
STAGE1_CREDITS:
  LDA #$03
  STA CIA2_BANK
  LDA #$1B          ; Standard Text Mode
  STA VIC_D011
  LDA #$08          ; 40-col, no scroll
  STA VIC_D016
  LDA #$14
  STA VIC_D018
  LDA #$00
  STA VIC_BG

  LDA #$02
  STA IRQ_STATE
  LDA #106          ; Row 7 (y=56)
  STA VIC_RAST
  JMP IRQ_DONE

; ---- STAGE 2 (Line 106): Switch to Double-Buffered Bitmap Mode (3D Cube + Stars) ----
STAGE2_CUBE:
  LDA ZP_SHOWBNK    ; Atomic Bank 0 ($03) or Bank 1 ($02)
  STA CIA2_BANK
  LDA #$3B          ; Hi-Res Bitmap Mode
  STA VIC_D011
  LDA #$08
  STA VIC_D016
  LDA #$18
  STA VIC_D018

  LDA #$03
  STA IRQ_STATE
  LDA #218          ; Row 21 (y=168)
  STA VIC_RAST
  JMP IRQ_DONE

; ---- STAGE 3 (Line 218): Full-Width Separator Line + 38-Col Smooth Fine-Scrolled Text (Row 22) ----
STAGE3_SCROLL:
  ; Switch to Bank 0 Text Mode first so the glowing divider slices cleanly across the full screen!
  LDA #$03
  STA CIA2_BANK
  LDA #$1B
  STA VIC_D011
  LDA #$14
  STA VIC_D018
  ; Glowing 2-scanline electric cyan/white divider bar
  LDA #$0E
  STA VIC_BDR
  STA VIC_BG
  LDA VIC_RAST
DIV_WAIT1:
  CMP VIC_RAST
  BEQ DIV_WAIT1
  LDA #$03
  STA VIC_BDR
  STA VIC_BG
  LDA VIC_RAST
DIV_WAIT2:
  CMP VIC_RAST
  BEQ DIV_WAIT2
  LDA #$00
  STA VIC_BDR
  STA VIC_BG

  ; Enable authentic 38-col VIC-II fine X-scroll ($D016 = 0..7) for Row 22 scroller
  LDA ZP_SCRX
  AND #$07
  STA VIC_D016

  LDA #$04
  STA IRQ_STATE
  LDA #236          ; Below Row 22 scroller (y=186)
  STA VIC_RAST
  JMP IRQ_DONE

; ---- STAGE 4 (Line 236): Static Footer + Animated Copper Floor + Scroll + 3-Voice SID ----
STAGE4_FLOOR_AND_ENGINE:
  ; Restore non-scrolling 40-col Text Mode for Row 24 (- MUSIC & CODE BY THEO / 6502 -)
  LDA #$08
  STA VIC_D016

  ; Wait for bottom border (line 250) and draw animated rolling DRAGON-style copper floor!
WAIT_FLOOR:
  LDA VIC_RAST
  CMP #250
  BCC WAIT_FLOOR

  LDX #$00
  LDY ZP_FLOOR
FLOOR_LP:
  LDA FLOOR_PAL,Y
  STA VIC_BDR
  LDA VIC_RAST
FLOOR_WAIT_LN:
  CMP VIC_RAST
  BEQ FLOOR_WAIT_LN
  INY
  TYA
  AND #$1F
  TAY
  INX
  CPX #22
  BNE FLOOR_LP
  LDA #$00
  STA VIC_BDR

  ; ---- 60HZ FRAME UPDATES ----
  INC ZP_FRAME
  LDA ZP_FRAME
  AND #$01
  BNE SKIP_FLOOR_ROLL
  INC ZP_FLOOR
  LDA ZP_FLOOR
  AND #$1F
  STA ZP_FLOOR
SKIP_FLOOR_ROLL:

  ; 1. Smooth 1px/frame Hardware Scroller (Row 22 = $0400 + 880 = $0770)
  DEC ZP_SCRX
  BPL SCROLL_FINE_OK
  LDA #$07
  STA ZP_SCRX
  ; Shift all 39 visible chars left by 1
  LDX #$00
SHIFT_SCR_LP:
  LDA $0771,X
  STA $0770,X
  INX
  CPX #39
  BNE SHIFT_SCR_LP
  ; Pull next screen code from SCROLL_DATA
  LDY #$00
  LDA (ZP_MSG_LO),Y
  CMP #$FF
  BNE PUT_SCR_CHAR
  LDA #<SCROLL_DATA
  STA ZP_MSG_LO
  LDA #>SCROLL_DATA
  STA ZP_MSG_HI
  LDA (ZP_MSG_LO),Y
PUT_SCR_CHAR:
  STA $0797         ; Rightmost column of Row 22 ($0770 + 39)
  INC ZP_MSG_LO
  BNE SCROLL_FINE_OK
  INC ZP_MSG_HI
SCROLL_FINE_OK:

  ; 2. Animated Metallic Copper/Gold Color-Wash on Credits (Rows 5-6) & Neon Wave on Scroller (Row 22)
  INC ZP_WASH
  LDA ZP_WASH
  LSR A
  TAX
  LDY #$00
WASH_LP:
  TXA
  AND #$1F
  STA IRQ_TMP
  TXA
  PHA
  LDX IRQ_TMP
  LDA COPPER_WASH,X
  STA $D8C8,Y       ; Row 5 Color RAM ($D800 + 5*40)
  LDA GOLD_WASH,X
  STA $D8F0,Y       ; Row 6 Color RAM ($D800 + 6*40)
  LDA SCROLL_WASH,X
  STA $DB70,Y       ; Row 22 Color RAM ($D800 + 22*40)
  PLA
  TAX
  INX
  INY
  CPY #40
  BNE WASH_LP

  ; 3. Poll Suncom TAC-2 Joystick ($DC00)
  JSR IRQ_POLL_JOY

  ; 4. Play 3-Voice 6581 SID Chiptune!
  JSR PLAY_SID_MUSIC

  ; Rearm Stage 0 for next frame
  LDA #$00
  STA IRQ_STATE
  LDA #18
  STA VIC_RAST

IRQ_DONE:
  PLA
  TAY
  PLA
  TAX
  PLA
  RTI

; ============================================================================
;   3-VOICE 6581 SID VAPORWAVE ENGINE (~88 BPM SUNSET NOSTALGIA)
;   Voice 1: Dreamy triangle lead + VHS tape-warble vibrato LFO
;   Voice 2: Deep warm analog sawtooth bass with lazy sustain
;   Voice 3: Slow cascading Maj7/Min9 harp arpeggio + soft brushed snare
; ============================================================================
PLAY_SID_MUSIC:
  ; ---- Gentle VHS Tape-Warble Vibrato on Voice 1 Lead ----
  LDA SID_L1_HI
  BEQ SKIP_VIB
  LDA ZP_FRAME
  AND #$01
  BNE SKIP_VIB
  INC SID_VIB
  LDA SID_VIB
  AND #$1F
  STA SID_VIB
  TAX
  LDA VIB_TBL,X
  BPL VIB_POS
  CLC
  ADC SID_L1_LO
  STA SID_V1_FL
  LDA SID_L1_HI
  BCS VIB_HI_OK
  SEC
  SBC #$01
  JMP VIB_HI_OK
VIB_POS:
  CLC
  ADC SID_L1_LO
  STA SID_V1_FL
  LDA SID_L1_HI
  ADC #$00
VIB_HI_OK:
  STA SID_V1_FH
SKIP_VIB:

  ; ---- Slow Cascading Dreamy 4-Note Chord Harp on Voice 3 ----
  LDA SID_SNARE
  BEQ DO_DREAM_ARP
  DEC SID_SNARE
  BNE CHECK_STEP
  LDA #$10          ; Release brushed snare cleanly
  STA SID_V3_CR
  JMP CHECK_STEP

DO_DREAM_ARP:
  DEC SID_ARPTK
  BPL CHECK_STEP
  LDA #$06          ; Gentle cascading harp note every 7 frames
  STA SID_ARPTK
  LDA SID_CHORD
  CLC
  ADC SID_ARP
  TAX
  LDA #$10
  STA SID_V3_CR
  LDA ARP_LO,X
  STA SID_V3_FL
  LDA ARP_HI,X
  STA SID_V3_FH
  LDA #$11          ; Soft shimmering triangle harp pluck!
  STA SID_V3_CR
  INC SID_ARP
  LDA SID_ARP
  AND #$03          ; 4-note lush Maj7/Min9 chord cycle
  STA SID_ARP

CHECK_STEP:
  ; Advance nostalgic 8th-note sequencer every 11 frames (~88 BPM vaporwave groove)
  DEC SID_TICK
  BMI DO_SONG_STEP
  RTS
DO_SONG_STEP:
  LDA #10
  STA SID_TICK

  LDX SID_STEP

  ; ---- Voice 1: Dreamy Sustained Lead (0=HOLD, 1=SOFT REST, else new note) ----
  LDA LEAD_HI,X
  BNE V1_NEW_NOTE
  LDA LEAD_LO,X
  BEQ DO_VOICE2     ; 0 = sustain/hold current dreamy note!
  ; 1 = soft rest/breath
  LDA #$10
  STA SID_V1_CR
  LDA #$00
  STA SID_L1_HI
  JMP DO_VOICE2
V1_NEW_NOTE:
  LDA #$10          ; Gate off triangle
  STA SID_V1_CR
  LDA LEAD_LO,X
  STA SID_L1_LO
  STA SID_V1_FL
  LDA LEAD_HI,X
  STA SID_L1_HI
  STA SID_V1_FH
  LDA #$11          ; Gate ON dreamy triangle lead!
  STA SID_V1_CR

  ; ---- Voice 2: Deep Warm Analog Vaporwave Bass (0=HOLD) ----
DO_VOICE2:
  LDA BASS_HI,X
  BEQ DO_VOICE3     ; 0 = hold warm sustained bass note!
  LDA #$20          ; Gate off sawtooth
  STA SID_V2_CR
  LDA BASS_LO,X
  STA SID_V2_FL
  LDA BASS_HI,X
  STA SID_V2_FH
  LDA #$21          ; Gate ON warm lowpassed analog bass!
  STA SID_V2_CR

  ; ---- Voice 3: Update 8-Bar Maj7/Min9 Chord + Soft Brushed Snare on Beat 4 ----
DO_VOICE3:
  ; Chord index = (SID_STEP >> 3) * 4
  TXA
  LSR A
  LSR A
  LSR A
  ASL A
  ASL A
  STA SID_CHORD

  ; Soft lo-fi vaporwave brushed snare on steps 4, 12, 20, 28, ... (step & 7 == 4)
  TXA
  AND #$07
  CMP #$04
  BNE NEXT_SONG_STEP
  LDA #$80
  STA SID_V3_CR
  LDA #$00
  STA SID_V3_FL
  LDA #$14          ; Warm low-pitched lo-fi LinnDrum brush snare
  STA SID_V3_FH
  LDA #$81
  STA SID_V3_CR
  LDA #$06
  STA SID_SNARE

NEXT_SONG_STEP:
  INX
  TXA
  AND #$3F          ; 64-step 8-bar sunset loop
  STA SID_STEP
SID_RET:
  RTS

; ============================================================================
;   TAC-2 JOYSTICK POLL ($DC00)
; ============================================================================
IRQ_POLL_JOY:
  LDA CIA_JOY2
  STA IRQ_TMP
  AND #$04
  BNE J_CHK_R
  LDA #$FB          ; -5
  STA ZP_VELY
  JMP J_CHK_U
J_CHK_R:
  LDA IRQ_TMP
  AND #$08
  BNE J_CHK_U
  LDA #$05          ; +5
  STA ZP_VELY
J_CHK_U:
  LDA IRQ_TMP
  AND #$01
  BNE J_CHK_D
  LDA #$FC          ; -4
  STA ZP_VELX
  JMP J_CHK_F
J_CHK_D:
  LDA IRQ_TMP
  AND #$02
  BNE J_CHK_F
  LDA #$04          ; +4
  STA ZP_VELX
J_CHK_F:
  LDA IRQ_TMP
  AND #$10
  BNE J_FIRE_UP
  LDA IRQ_FIRE
  BNE J_DONE
  LDA #$01
  STA IRQ_FIRE
  INC ZP_PAL
  LDA ZP_PAL
  CMP #$03
  BCC J_PAL_OK
  LDA #$00
  STA ZP_PAL
J_PAL_OK:
  LDA #$01
  STA ZP_PAL_CHG
  LDA #$03
  STA ZP_VELY
  LDA #$02
  STA ZP_VELX
  RTS
J_FIRE_UP:
  LDA #$00
  STA IRQ_FIRE
J_DONE:
  RTS

; ============================================================================
;   3-LAYER PARALLAX STARFIELD (DOUBLE-BUFFERED ON BANK 0 & BANK 1)
; ============================================================================
ERASE_STARS_PG0:
  LDX #17
ES0_LP:
  STX ZP_IDX
  LDA STAR_O0,X
  STA ZP_X0
  LDA STAR_Y_TBL,X
  STA ZP_Y0
  JSR CLEAR_STAR_PX
  LDX ZP_IDX
  DEX
  BPL ES0_LP
  RTS

ERASE_STARS_PG1:
  LDX #17
ES1_LP:
  STX ZP_IDX
  LDA STAR_O1,X
  STA ZP_X0
  LDA STAR_Y_TBL,X
  STA ZP_Y0
  JSR CLEAR_STAR_PX
  LDX ZP_IDX
  DEX
  BPL ES1_LP
  RTS

UPDATE_AND_DRAW_STARS:
  LDX #17
US_LP:
  STX ZP_IDX
  ; Advance star left by its parallax layer speed (1, 2, or 3 px)
  SEC
  LDA STAR_X,X
  SBC STAR_SPD_TBL,X
  STA STAR_X,X
  STA ZP_X0
  ; Store into current back-buffer's old-X array for spotless next erase
  LDA ZP_BACKPG
  BNE SAVE_O1
  LDA ZP_X0
  STA STAR_O0,X
  JMP PLOT_STAR
SAVE_O1:
  LDA ZP_X0
  STA STAR_O1,X
PLOT_STAR:
  LDA STAR_Y_TBL,X
  STA ZP_Y0
  JSR SET_STAR_PX
  LDX ZP_IDX
  DEX
  BPL US_LP
  RTS

; Set 1px star (or 2px streak for fast foreground layer!) at (ZP_X0, ZP_Y0)
SET_STAR_PX:
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
  LDA (ZP_PTR_LO),Y
  ORA BIT_MASK,X
  STA (ZP_PTR_LO),Y
  RTS

CLEAR_STAR_PX:
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
  LDA (ZP_PTR_LO),Y
  AND INV_MASK,X
  STA (ZP_PTR_LO),Y
  RTS

; ============================================================================
;   INIT HELPERS: CLEAR BITMAP, COPY CHROME LOGO, COLOR MATRICES & TEXT ROWS
; ============================================================================
CLEAR_8KB:
  STA ZP_PTR_HI
  LDA #$00
  STA ZP_PTR_LO
  LDX #$20
C8_PG:
  LDY #$00
  LDA #$00
C8_BT:
  STA (ZP_PTR_LO),Y
  INY
  BNE C8_BT
  INC ZP_PTR_HI
  DEX
  BNE C8_PG
  RTS

; Copy 1600 bytes (6 pages + 64 bytes) from LOGO_BITMAP -> $2000
COPY_LOGO:
  LDA #<LOGO_BITMAP
  STA ZP_SRC_LO
  LDA #>LOGO_BITMAP
  STA ZP_SRC_HI
  LDA #$00
  STA ZP_PTR_LO
  LDA #$20
  STA ZP_PTR_HI
  LDX #$06          ; 6 full pages = 1536 bytes
CL_PG:
  LDY #$00
CL_BT:
  LDA (ZP_SRC_LO),Y
  STA (ZP_PTR_LO),Y
  INY
  BNE CL_BT
  INC ZP_SRC_HI
  INC ZP_PTR_HI
  DEX
  BNE CL_PG
  ; Remaining 64 bytes
  LDY #63
CL_REM:
  LDA (ZP_SRC_LO),Y
  STA (ZP_PTR_LO),Y
  DEY
  BPL CL_REM
  RTS

INIT_SCREEN_LAYOUT:
  ; 1. Paint Chrome Logo color matrix (Rows 0-4 in Bank 0 $0400-$04C7)
  LDX #39
LOGO_COL_LP:
  LDA #$10          ; Row 0: White on Black
  STA $0400,X
  LDA #$30          ; Row 1: Cyan on Black
  STA $0428,X
  LDA #$10          ; Row 2: Gleaming White Horizon
  STA $0450,X
  LDA #$E0          ; Row 3: Light Blue Chrome
  STA $0478,X
  LDA #$60          ; Row 4: Deep Blue Reflection
  STA $04A0,X
  DEX
  BPL LOGO_COL_LP

  ; 2. Populate Text Mode Credits (Rows 5-6), Blank Scroller (Row 22), Static Footer (Row 24)
  LDX #39
TXT_INIT_LP:
  LDA CREDIT1_TXT,X
  STA $04C8,X       ; Row 5 ($0400 + 200)
  LDA CREDIT2_TXT,X
  STA $04F0,X       ; Row 6 ($0400 + 240)
  LDA #$20          ; Space
  STA $0748,X       ; Row 21 (under divider)
  STA $0770,X       ; Row 22 (scroller)
  STA $0798,X       ; Row 23 (blank gap)
  LDA FOOTER_TXT,X
  STA $07C0,X       ; Row 24 (- MUSIC & CODE BY THEO / 6502 -)
  LDA #$0E          ; Light blue footer text color
  STA $DBC0,X       ; Row 24 Color RAM
  DEX
  BPL TXT_INIT_LP

  ; 3. Paint Cube + Parallax Arena Color Matrix (Rows 7-20 in BOTH Bank 0 & Bank 1!)
  JSR PAINT_ARENA_PALETTE
  RTS

; Paint Rows 7-20 ($0518-$0747 and $4518-$4747) with selected neon vertical gradient!
PAINT_ARENA_PALETTE:
  LDA #$05
  JSR FILL_ARENA_AT
  LDA #$45
  JSR FILL_ARENA_AT
  RTS

FILL_ARENA_AT:
  STA ZP_PTR_HI
  LDA #$18
  STA ZP_PTR_LO
  LDA ZP_PAL
  ASL A
  ASL A
  ASL A
  TAX
  LDA #$07          ; 7 bands of 2 char rows (80 cells each) = 14 rows (Rows 7..20)
  STA ZP_CNT
AR_BAND:
  LDA ARENA_PALS,X
  INX
  LDY #79
AR_CELL:
  STA (ZP_PTR_LO),Y
  DEY
  BPL AR_CELL
  CLC
  LDA ZP_PTR_LO
  ADC #80
  STA ZP_PTR_LO
  BCC AR_NO_HI
  INC ZP_PTR_HI
AR_NO_HI:
  DEC ZP_CNT
  BNE AR_BAND
  RTS

; ============================================================================
;   3D PRODUCT-TO-SUM ROTATION + PERSPECTIVE PROJECTION (CENTER Y = 112)
; ============================================================================
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
  ADC #112          ; Centered cleanly inside Rows 7..20 (y=56..167)!
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

; ============================================================================
;   FAST 8-BIT DOUBLE-BUFFERED BRESENHAM LINE RENDERER
; ============================================================================
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

; ============================================================================
;   DATA TABLES — PALETTES, RASTER BARS, TEXT, 3-VOICE SID SONG & CHROME LOGO
; ============================================================================
EDGE_A:
  .BYTE 0,1,3,2, 4,5,7,6, 0,1,2,3
EDGE_B:
  .BYTE 1,3,2,0, 5,7,6,4, 4,5,6,7

BIT_MASK:
  .BYTE $80,$40,$20,$10,$08,$04,$02,$01
INV_MASK:
  .BYTE $7F,$BF,$DF,$EF,$F7,$FB,$FD,$FE

; Top border chrome-blue copper bar (12 scanlines)
TOP_RASTER_BAR:
  .BYTE $06,$06,$0E,$03,$01,$01,$03,$0E,$06,$06,$00,$00

; Animated rolling DRAGON-inspired warm/cool copper floor (32-entry looping table)
FLOOR_PAL:
  .BYTE $06,$0E,$03,$01,$07,$08,$09,$02,$08,$07,$01,$03,$0E,$06,$00,$00
  .BYTE $04,$0A,$07,$01,$0D,$05,$03,$0E,$06,$04,$0A,$07,$01,$03,$0E,$06

; 32-entry metallic color-wash tables for credits & scroller!
COPPER_WASH:
  .BYTE $0B,$0C,$0F,$01,$01,$0F,$07,$08,$09,$08,$07,$01,$0F,$0C,$0B,$0C
  .BYTE $0F,$01,$03,$0E,$06,$0E,$03,$01,$0F,$07,$08,$0A,$07,$01,$0F,$0C

GOLD_WASH:
  .BYTE $09,$08,$0A,$07,$01,$07,$0A,$08,$09,$0B,$0C,$0F,$01,$0F,$0C,$0B
  .BYTE $09,$08,$07,$01,$01,$07,$08,$09,$06,$0E,$03,$01,$03,$0E,$06,$09

; Extend-inspired vivid neon green/yellow/white scroller wash!
SCROLL_WASH:
  .BYTE $05,$05,$0D,$0D,$07,$01,$01,$07,$0D,$0D,$05,$05,$03,$03,$01,$07
  .BYTE $08,$0A,$07,$01,$0D,$0D,$05,$05,$0D,$07,$01,$07,$0D,$05,$03,$0E

; 3 selectable neon bitmap color gradients for Rows 7..20 (7 bands of 2 rows each)
ARENA_PALS:
  ; Theme 0: Cyber Cyan / White / Electric Blue
  .BYTE $60,$E0,$30,$10,$30,$E0,$60,$00
  ; Theme 1: Extend Phosphor Green / Yellow / White
  .BYTE $50,$D0,$70,$10,$70,$D0,$50,$00
  ; Theme 2: Blazon Synth Purple / Peach / White
  .BYTE $40,$A0,$70,$10,$70,$A0,$40,$00

STAR_INIT_X_TBL:
  .BYTE $0C,$36,$62,$8E,$BC,$E8,$1A,$48,$76,$A6,$D2,$F6,$28,$58,$86,$B2,$DC,$08
STAR_Y_TBL:
  .BYTE $3C,$4E,$60,$76,$8A,$9E,$42,$56,$6A,$7E,$92,$A2,$48,$5C,$70,$84,$98,$3E
STAR_SPD_TBL:
  .BYTE $01,$01,$01,$01,$01,$01,$02,$02,$02,$02,$02,$02,$03,$03,$03,$03,$03,$03

CREDIT1_TXT:
  .BYTE $20,$20,$20,$20,$20,$20,$20,$14,$14,$02,$20,$20,$2A,$20,$20,$19,$05,$14,$20,$01
  .BYTE $0E,$0F,$14,$08,$05,$12,$20,$09,$0E,$14,$12,$0F,$20,$20,$20,$20,$20,$20,$20,$20
CREDIT2_TXT:
  .BYTE $20,$2A,$2A,$2A,$20,$03,$0F,$04,$05,$16,$05,$0D,$02,$05,$12,$20,$32,$30,$32,$36
  .BYTE $20,$2B,$20,$07,$05,$0D,$09,$0E,$09,$20,$34,$20,$0E,$05,$0F,$0E,$20,$2A,$2A,$2A
FOOTER_TXT:
  .BYTE $20,$20,$20,$2D,$20,$03,$0F,$04,$05,$20,$26,$20,$13,$09,$04,$3A,$20,$14,$14,$02
  .BYTE $20,$2B,$20,$07,$05,$0D,$09,$0E,$09,$20,$34,$20,$0E,$05,$0F,$0E,$20,$2D,$20,$20

SCROLL_DATA:
  .BYTE $20,$20,$2A,$2A,$2A,$20,$03,$0F,$04,$05,$16,$05,$0D,$02,$05,$12,$20,$32,$30,$32
  .BYTE $36,$20,$2A,$2A,$2A,$20,$20,$20,$20,$14,$14,$02,$20,$10,$12,$05,$13,$05,$0E,$14
  .BYTE $13,$3A,$20,$19,$05,$14,$20,$01,$0E,$0F,$14,$08,$05,$12,$20,$09,$0E,$14,$12,$0F
  .BYTE $21,$21,$20,$20,$20,$20,$03,$0F,$04,$05,$04,$20,$09,$0E,$20,$10,$15,$12,$05,$20
  .BYTE $36,$35,$30,$32,$20,$01,$13,$13,$05,$0D,$02,$0C,$19,$20,$02,$19,$20,$14,$14,$02
  .BYTE $20,$26,$20,$07,$05,$0D,$09,$0E,$09,$20,$34,$20,$0E,$05,$0F,$0E,$20,$0F,$0E,$20
  .BYTE $01,$20,$16,$09,$12,$14,$15,$01,$0C,$20,$03,$36,$34,$2E,$2E,$2E,$20,$20,$20,$20
  .BYTE $06,$05,$01,$14,$15,$12,$09,$0E,$07,$3A,$20,$03,$08,$12,$0F,$0D,$05,$20,$0C,$0F
  .BYTE $07,$0F,$20,$2D,$20,$33,$20,$0C,$01,$19,$05,$12,$20,$10,$01,$12,$01,$0C,$0C,$01
  .BYTE $18,$20,$13,$14,$01,$12,$13,$20,$2D,$20,$04,$0F,$15,$02,$0C,$05,$20,$02,$15,$06
  .BYTE $06,$05,$12,$05,$04,$20,$33,$04,$20,$16,$05,$03,$14,$0F,$12,$20,$03,$15,$02,$05
  .BYTE $20,$2D,$20,$16,$09,$03,$2D,$09,$09,$20,$12,$01,$13,$14,$05,$12,$20,$13,$10,$0C
  .BYTE $09,$14,$13,$20,$2D,$20,$33,$20,$16,$0F,$09,$03,$05,$20,$36,$35,$38,$31,$20,$13
  .BYTE $09,$04,$20,$14,$15,$0E,$05,$20,$2D,$20,$1A,$05,$12,$0F,$20,$0D,$05,$12,$03,$19
  .BYTE $21,$21,$20,$20,$20,$20,$0D,$05,$07,$01,$20,$07,$12,$05,$05,$14,$1A,$20,$14,$0F
  .BYTE $3A,$20,$06,$12,$0F,$0E,$14,$09,$05,$12,$13,$20,$2D,$20,$05,$18,$14,$05,$0E,$04
  .BYTE $20,$2D,$20,$02,$0C,$01,$1A,$0F,$0E,$20,$2D,$20,$06,$01,$09,$12,$0C,$09,$07,$08
  .BYTE $14,$20,$2D,$20,$14,$12,$09,$01,$04,$20,$2D,$20,$07,$05,$0D,$09,$0E,$09,$20,$34
  .BYTE $20,$0E,$05,$0F,$0E,$20,$2D,$20,$01,$0E,$04,$20,$01,$0C,$0C,$20,$03,$0F,$04,$05
  .BYTE $16,$05,$0D,$02,$05,$12,$20,$03,$12,$05,$01,$14,$0F,$12,$13,$20,$17,$0F,$12,$0C
  .BYTE $04,$17,$09,$04,$05,$21,$21,$20,$20,$20,$20,$15,$13,$05,$20,$01,$12,$12,$0F,$17
  .BYTE $13,$20,$0F,$12,$20,$14,$01,$03,$2D,$32,$20,$14,$0F,$20,$13,$14,$05,$05,$12,$20
  .BYTE $14,$08,$05,$20,$03,$15,$02,$05,$20,$2D,$20,$10,$12,$05,$13,$13,$20,$13,$10,$01
  .BYTE $03,$05,$2F,$06,$09,$12,$05,$20,$14,$0F,$20,$13,$17,$09,$14,$03,$08,$20,$0E,$05
  .BYTE $0F,$0E,$20,$10,$01,$0C,$05,$14,$14,$05,$20,$2D,$20,$10,$12,$05,$13,$13,$20,$05
  .BYTE $13,$03,$20,$14,$0F,$20,$02,$12,$05,$01,$0B,$2E,$2E,$2E,$20,$20,$20,$20,$14,$14
  .BYTE $02,$20,$26,$20,$07,$05,$0D,$09,$0E,$09,$20,$34,$20,$0E,$05,$0F,$0E,$21,$21,$20
  .BYTE $20,$20,$20,$17,$12,$01,$10,$20,$01,$12,$0F,$15,$0E,$04,$2E,$2E,$2E,$20,$20,$20
  .BYTE $20,$20,$20,$20,$20,$20,$20,$FF

; ---- 3-Voice 6581 SID Vaporwave Song Data (64 steps, Fmaj7-Em7-Dm9-Cmaj7) ----
LEAD_LO:
  .BYTE $3D,$00,$00,$A1,$86,$00,$31,$00,$A4,$00,$00,$A1,$1D,$00,$00,$01
  .BYTE $3D,$00,$C0,$3D,$A1,$00,$31,$00,$A4,$00,$00,$31,$1D,$00,$00,$01
  .BYTE $31,$00,$A1,$00,$C0,$00,$3D,$A1,$86,$00,$00,$A4,$31,$00,$1E,$01
  .BYTE $31,$00,$DE,$31,$1D,$00,$A1,$00,$A1,$00,$86,$00,$1D,$00,$31,$01
LEAD_HI:
  .BYTE $2A,$00,$00,$25,$21,$00,$1C,$00,$1F,$00,$00,$25,$19,$00,$00,$00
  .BYTE $2A,$00,$2C,$2A,$25,$00,$1C,$00,$1F,$00,$00,$1C,$19,$00,$00,$00
  .BYTE $1C,$00,$25,$00,$2C,$00,$2A,$25,$21,$00,$00,$1F,$1C,$00,$15,$00
  .BYTE $1C,$00,$1D,$1C,$19,$00,$25,$00,$25,$00,$21,$00,$19,$00,$1C,$00
BASS_LO:
  .BYTE $98,$00,$00,$98,$00,$61,$98,$00,$48,$00,$00,$48,$00,$E9,$48,$00
  .BYTE $B4,$00,$00,$B4,$00,$0C,$B4,$00,$31,$00,$00,$31,$00,$47,$31,$00
  .BYTE $BC,$00,$00,$BC,$00,$98,$77,$00,$86,$00,$00,$86,$00,$48,$0C,$00
  .BYTE $24,$00,$00,$24,$00,$B4,$47,$00,$31,$00,$00,$31,$00,$47,$B4,$31
BASS_HI:
  .BYTE $05,$00,$00,$05,$00,$08,$05,$00,$05,$00,$00,$05,$00,$07,$05,$00
  .BYTE $04,$00,$00,$04,$00,$07,$04,$00,$04,$00,$00,$04,$00,$06,$04,$00
  .BYTE $03,$00,$00,$03,$00,$05,$07,$00,$03,$00,$00,$03,$00,$05,$07,$00
  .BYTE $03,$00,$00,$03,$00,$04,$06,$00,$04,$00,$00,$04,$00,$06,$04,$04
ARP_LO:
  .BYTE $30,$18,$C3,$1E,$8F,$8F,$D2,$D0,$68,$30,$18,$1E,$61,$8F,$8F,$D2
  .BYTE $EF,$D0,$60,$31,$18,$C3,$1E,$1D,$8F,$EF,$D0,$31,$61,$8F,$EF,$D0
ARP_HI:
  .BYTE $0B,$0E,$10,$15,$0A,$0C,$0F,$12,$09,$0B,$0E,$15,$08,$0A,$0C,$0F
  .BYTE $0E,$12,$16,$1C,$0E,$10,$15,$19,$0C,$0E,$12,$1C,$08,$0C,$0E,$12
VIB_TBL:
  .BYTE $00,$01,$01,$02,$02,$02,$03,$03,$03,$03,$03,$02,$02,$02,$01,$01
  .BYTE $00,$FF,$FF,$FE,$FE,$FE,$FD,$FD,$FD,$FD,$FD,$FE,$FE,$FE,$FF,$FF

; ---- 3D Trig, Perspective & Bitmap Row Address Tables ----
SIN_TBL:
  .BYTE $00,$01,$02,$02,$03,$04,$05,$05,$06,$07,$08,$09,$09,$0A,$0B,$0C
  .BYTE $0C,$0D,$0E,$0E,$0F,$10,$10,$11,$12,$12,$13,$14,$14,$15,$15,$16
  .BYTE $17,$17,$18,$18,$19,$19,$1A,$1A,$1B,$1B,$1B,$1C,$1C,$1D,$1D,$1D
  .BYTE $1E,$1E,$1E,$1E,$1F,$1F,$1F,$1F,$1F,$20,$20,$20,$20,$20,$20,$20
  .BYTE $20,$20,$20,$20,$20,$20,$20,$20,$1F,$1F,$1F,$1F,$1F,$1E,$1E,$1E
  .BYTE $1E,$1D,$1D,$1D,$1C,$1C,$1B,$1B,$1B,$1A,$1A,$19,$19,$18,$18,$17
  .BYTE $17,$16,$15,$15,$14,$14,$13,$12,$12,$11,$10,$10,$0F,$0E,$0E,$0D
  .BYTE $0C,$0C,$0B,$0A,$09,$09,$08,$07,$06,$05,$05,$04,$03,$02,$02,$01
  .BYTE $00,$FF,$FE,$FE,$FD,$FC,$FB,$FB,$FA,$F9,$F8,$F7,$F7,$F6,$F5,$F4
  .BYTE $F4,$F3,$F2,$F2,$F1,$F0,$F0,$EF,$EE,$EE,$ED,$EC,$EC,$EB,$EB,$EA
  .BYTE $E9,$E9,$E8,$E8,$E7,$E7,$E6,$E6,$E5,$E5,$E5,$E4,$E4,$E3,$E3,$E3
  .BYTE $E2,$E2,$E2,$E2,$E1,$E1,$E1,$E1,$E1,$E0,$E0,$E0,$E0,$E0,$E0,$E0
  .BYTE $E0,$E0,$E0,$E0,$E0,$E0,$E0,$E0,$E1,$E1,$E1,$E1,$E1,$E2,$E2,$E2
  .BYTE $E2,$E3,$E3,$E3,$E4,$E4,$E5,$E5,$E5,$E6,$E6,$E7,$E7,$E8,$E8,$E9
  .BYTE $E9,$EA,$EB,$EB,$EC,$EC,$ED,$EE,$EE,$EF,$F0,$F0,$F1,$F2,$F2,$F3
  .BYTE $F4,$F4,$F5,$F6,$F7,$F7,$F8,$F9,$FA,$FB,$FB,$FC,$FD,$FE,$FE,$FF
PERSP_TBL:
  .BYTE $34,$34,$34,$34,$35,$35,$35,$35,$35,$35,$36,$36,$36,$36,$36,$36
  .BYTE $37,$37,$37,$37,$37,$38,$38,$38,$38,$38,$38,$39,$39,$39,$39,$39
  .BYTE $3A,$3A,$3A,$3A,$3A,$3B,$3B,$3B,$3B,$3B,$3C,$3C,$3C,$3C,$3D,$3D
  .BYTE $3D,$3D,$3D,$3E,$3E,$3E,$3E,$3F,$3F,$3F,$3F,$40,$40,$40,$40,$41
  .BYTE $41,$41,$41,$42,$42,$42,$42,$43,$43,$43,$43,$44,$44,$44,$44,$45
  .BYTE $45,$45,$46,$46,$46,$46,$47,$47,$47,$48,$48,$48,$49,$49,$49,$4A
  .BYTE $4A,$4A,$4B,$4B,$4B,$4C,$4C,$4C,$4D,$4D,$4D,$4E,$4E,$4E,$4F,$4F
  .BYTE $4F,$50,$50,$51,$51,$51,$52,$52,$53,$53,$53,$54,$54,$55,$55,$56
  .BYTE $56,$56,$57,$57,$58,$58,$59,$59,$5A,$5A,$5B,$5B,$5C,$5C,$5D,$5D
  .BYTE $5E,$5E,$5F,$5F,$60,$60,$61,$62,$62,$63,$63,$64,$64,$65,$66,$66
  .BYTE $67,$68,$68,$69,$69,$6A,$6B,$6C,$6C,$6D,$6E,$6E,$6F,$70,$71,$71
  .BYTE $72,$73,$74,$74,$75,$76,$77,$78,$79,$7A,$7A,$7B,$7C,$7D,$7E,$7F
  .BYTE $80,$81,$82,$83,$84,$85,$86,$87,$88,$89,$8B,$8C,$8D,$8E,$8F,$91
  .BYTE $92,$93,$94,$96,$97,$98,$9A,$9B,$9D,$9E,$A0,$A1,$A3,$A4,$A6,$A8
  .BYTE $A9,$AB,$AD,$AF,$B1,$B2,$B4,$B6,$B8,$BA,$BC,$BC,$BC,$BC,$BC,$BC
  .BYTE $BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC,$BC
ROW_LO:
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27,$60,$61,$62,$63,$64,$65,$66,$67
  .BYTE $A0,$A1,$A2,$A3,$A4,$A5,$A6,$A7,$E0,$E1,$E2,$E3,$E4,$E5,$E6,$E7
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27,$60,$61,$62,$63,$64,$65,$66,$67
  .BYTE $A0,$A1,$A2,$A3,$A4,$A5,$A6,$A7,$E0,$E1,$E2,$E3,$E4,$E5,$E6,$E7
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27,$60,$61,$62,$63,$64,$65,$66,$67
  .BYTE $A0,$A1,$A2,$A3,$A4,$A5,$A6,$A7,$E0,$E1,$E2,$E3,$E4,$E5,$E6,$E7
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27,$60,$61,$62,$63,$64,$65,$66,$67
  .BYTE $A0,$A1,$A2,$A3,$A4,$A5,$A6,$A7,$E0,$E1,$E2,$E3,$E4,$E5,$E6,$E7
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27,$60,$61,$62,$63,$64,$65,$66,$67
  .BYTE $A0,$A1,$A2,$A3,$A4,$A5,$A6,$A7,$E0,$E1,$E2,$E3,$E4,$E5,$E6,$E7
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27,$60,$61,$62,$63,$64,$65,$66,$67
  .BYTE $A0,$A1,$A2,$A3,$A4,$A5,$A6,$A7,$E0,$E1,$E2,$E3,$E4,$E5,$E6,$E7
  .BYTE $20,$21,$22,$23,$24,$25,$26,$27
ROW_HI:
  .BYTE $20,$20,$20,$20,$20,$20,$20,$20,$21,$21,$21,$21,$21,$21,$21,$21
  .BYTE $22,$22,$22,$22,$22,$22,$22,$22,$23,$23,$23,$23,$23,$23,$23,$23
  .BYTE $25,$25,$25,$25,$25,$25,$25,$25,$26,$26,$26,$26,$26,$26,$26,$26
  .BYTE $27,$27,$27,$27,$27,$27,$27,$27,$28,$28,$28,$28,$28,$28,$28,$28
  .BYTE $2A,$2A,$2A,$2A,$2A,$2A,$2A,$2A,$2B,$2B,$2B,$2B,$2B,$2B,$2B,$2B
  .BYTE $2C,$2C,$2C,$2C,$2C,$2C,$2C,$2C,$2D,$2D,$2D,$2D,$2D,$2D,$2D,$2D
  .BYTE $2F,$2F,$2F,$2F,$2F,$2F,$2F,$2F,$30,$30,$30,$30,$30,$30,$30,$30
  .BYTE $31,$31,$31,$31,$31,$31,$31,$31,$32,$32,$32,$32,$32,$32,$32,$32
  .BYTE $34,$34,$34,$34,$34,$34,$34,$34,$35,$35,$35,$35,$35,$35,$35,$35
  .BYTE $36,$36,$36,$36,$36,$36,$36,$36,$37,$37,$37,$37,$37,$37,$37,$37
  .BYTE $39,$39,$39,$39,$39,$39,$39,$39,$3A,$3A,$3A,$3A,$3A,$3A,$3A,$3A
  .BYTE $3B,$3B,$3B,$3B,$3B,$3B,$3B,$3B,$3C,$3C,$3C,$3C,$3C,$3C,$3C,$3C
  .BYTE $3E,$3E,$3E,$3E,$3E,$3E,$3E,$3E

; ---- Sculpted 320x40 Chrome-Blue "CODEVEMBER" Cracktro Logo (1600 bytes) ----
LOGO_BITMAP:
  .BYTE $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
  .BYTE $00,$00,$00,$00,$00,$03,$03,$02,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$C0,$E0,$50
  .BYTE $00,$00,$00,$00,$00,$1F,$1F,$1E,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$C0,$E0,$50,$00,$00,$00,$00,$00,$1F,$1F,$1E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$FE,$8E,$3F
  .BYTE $00,$00,$00,$00,$00,$00,$80,$00,$00,$00,$00,$00,$00,$FF,$8F,$BE
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$87,$A7,$C6,$00,$00,$00,$00,$00,$FE,$8E,$3F
  .BYTE $00,$00,$00,$00,$00,$0F,$8F,$0E,$00,$00,$00,$00,$00,$FC,$8E,$3D
  .BYTE $00,$00,$00,$00,$00,$3F,$2F,$3E,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$E1,$A9,$31
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$83,$A3,$C2
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3F,$00,$00,$00,$00,$00,$0F,$8F,$4E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$FF,$8F,$3F
  .BYTE $00,$00,$00,$00,$00,$00,$80,$40,$00,$00,$00,$00,$00,$7F,$4F,$7E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$C3,$E3,$52,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$00,$00,$00,$00,$00,$C0,$E0,$50
  .BYTE $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
  .BYTE $00,$00,$AA,$AA,$00,$00,$00,$00,$00,$00,$AA,$AA,$00,$00,$00,$00
  .BYTE $02,$7F,$4F,$7E,$78,$63,$4F,$6A,$FF,$F5,$AA,$30,$E8,$F0,$A8,$B0
  .BYTE $FF,$55,$AA,$00,$00,$00,$00,$00,$E0,$53,$A3,$02,$02,$03,$03,$02
  .BYTE $18,$E3,$8F,$3F,$F9,$E3,$8F,$AB,$F8,$57,$AF,$46,$84,$47,$87,$46
  .BYTE $E0,$FE,$8E,$3F,$FA,$E3,$8E,$AB,$18,$13,$9F,$1E,$98,$13,$9F,$1A
  .BYTE $FF,$ED,$8A,$3C,$FA,$EC,$8A,$AC,$FA,$63,$AF,$3E,$38,$23,$2F,$2A
  .BYTE $80,$F0,$98,$34,$F8,$F4,$98,$B4,$F8,$E3,$8F,$BE,$F8,$E3,$8F,$AA
  .BYTE $FF,$D5,$EA,$50,$E0,$FF,$8F,$AA,$FF,$55,$AA,$00,$00,$F0,$98,$B4
  .BYTE $A4,$47,$A7,$06,$04,$07,$07,$06,$FA,$E3,$8E,$3F,$FA,$E3,$8E,$AB
  .BYTE $88,$0B,$AF,$2E,$88,$0B,$8F,$0A,$FE,$E5,$8E,$3D,$FE,$E5,$8E,$AD
  .BYTE $38,$23,$2F,$3E,$38,$23,$2F,$2A,$FF,$F5,$9A,$34,$F8,$EF,$8F,$AA
  .BYTE $FF,$55,$AA,$00,$00,$FC,$8E,$AD,$E9,$51,$A9,$01,$01,$01,$01,$01
  .BYTE $F8,$E3,$8F,$3E,$F8,$E3,$8F,$AA,$A2,$FF,$8F,$3E,$F8,$E3,$8F,$AA
  .BYTE $F9,$E3,$8F,$3F,$F9,$E3,$8F,$AB,$88,$4B,$8F,$4E,$88,$4B,$8F,$4A
  .BYTE $FB,$E5,$8E,$3D,$FE,$E3,$8F,$AA,$F9,$53,$BF,$1E,$18,$E3,$8F,$AB
  .BYTE $80,$F8,$8A,$3C,$FA,$54,$AA,$40,$78,$63,$4F,$7E,$78,$63,$4F,$6A
  .BYTE $FF,$F5,$AA,$30,$E8,$FF,$8F,$AA,$FF,$55,$AA,$00,$00,$F8,$8A,$AC
  .BYTE $E2,$53,$A3,$02,$02,$03,$03,$02,$F8,$E3,$8F,$3F,$F9,$E3,$8F,$AB
  .BYTE $F8,$57,$AF,$46,$84,$47,$87,$46,$E0,$FE,$8E,$3F,$FA,$E3,$8E,$AB
  .BYTE $00,$00,$AA,$2A,$80,$00,$80,$00,$00,$00,$AA,$AA,$00,$00,$00,$00
  .BYTE $AA,$AA,$00,$00,$00,$00,$AA,$AA,$AA,$AA,$00,$00,$00,$00,$AA,$AA
  .BYTE $6A,$7F,$6A,$6A,$78,$63,$4F,$7E,$AA,$F2,$A8,$B0,$E8,$F0,$AA,$32
  .BYTE $AA,$AA,$00,$00,$00,$00,$AA,$AA,$AA,$AB,$02,$02,$02,$03,$AB,$AA
  .BYTE $AB,$FF,$AB,$AB,$F9,$E3,$8F,$3F,$86,$47,$86,$46,$84,$47,$87,$46
  .BYTE $AA,$FF,$AA,$AB,$FA,$E3,$8E,$3F,$9A,$1F,$9A,$1A,$98,$13,$9F,$1E
  .BYTE $AA,$FC,$AA,$AC,$FA,$EC,$8A,$3C,$AA,$BF,$2A,$2A,$38,$23,$AF,$BE
  .BYTE $B8,$F4,$B8,$B4,$F8,$F4,$98,$34,$AA,$FF,$AA,$AA,$F8,$E3,$8F,$BE
  .BYTE $AA,$FF,$AA,$AA,$FF,$D5,$EA,$50,$B8,$F4,$B8,$B4,$F8,$54,$A8,$00
  .BYTE $A6,$A7,$06,$06,$04,$07,$A7,$A6,$AA,$FF,$AA,$AB,$FA,$E3,$8E,$3F
  .BYTE $AA,$2F,$8A,$0A,$88,$0B,$AF,$2E,$AE,$FD,$AE,$AD,$FE,$E5,$8E,$3D
  .BYTE $2A,$3F,$2A,$2A,$38,$23,$2F,$3E,$AA,$FF,$AA,$AA,$FF,$F5,$9A,$34
  .BYTE $AE,$FD,$AE,$AD,$FE,$55,$AA,$00,$29,$29,$01,$01,$01,$01,$29,$29
  .BYTE $AA,$FF,$AA,$AA,$F8,$E3,$8F,$3E,$FE,$D7,$AA,$C2,$A2,$C3,$AB,$CA
  .BYTE $AB,$FF,$AB,$AB,$F9,$E3,$8F,$3F,$8A,$4F,$8A,$4A,$88,$4B,$8F,$4E
  .BYTE $AA,$FF,$AA,$AA,$FB,$E5,$8E,$3D,$AB,$FF,$AB,$AB,$F9,$53,$BF,$1E
  .BYTE $8A,$4A,$80,$40,$80,$F8,$8A,$3C,$6A,$7F,$6A,$6A,$78,$63,$4F,$7E
  .BYTE $AA,$FF,$AA,$AA,$FF,$F5,$AA,$30,$AA,$FC,$AA,$AC,$FA,$54,$AA,$00
  .BYTE $AA,$AB,$02,$02,$02,$03,$AB,$AA,$AB,$FF,$AA,$AA,$F8,$E3,$8F,$3E
  .BYTE $86,$FF,$AA,$AA,$FF,$ED,$8A,$3C,$BE,$D5,$EA,$D0,$E0,$50,$A2,$02
  .BYTE $AA,$2A,$80,$00,$00,$00,$AA,$AA,$AA,$AA,$00,$00,$00,$00,$AA,$AA
  .BYTE $00,$00,$00,$00,$AA,$AA,$00,$00,$00,$00,$00,$00,$AA,$AA,$00,$00
  .BYTE $78,$63,$4F,$7E,$7C,$17,$2B,$02,$E8,$F0,$A8,$30,$E8,$FF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$02,$03,$03,$02,$0B,$C1,$E0,$50
  .BYTE $F9,$E3,$8F,$3F,$F9,$53,$BF,$1E,$84,$47,$87,$46,$84,$FB,$8F,$3E
  .BYTE $FA,$E3,$8E,$3F,$FE,$D5,$EA,$50,$98,$13,$9F,$1E,$98,$13,$9F,$1E
  .BYTE $FA,$EC,$8A,$3C,$FA,$E7,$8F,$3E,$38,$23,$2F,$3E,$39,$E3,$8E,$3F
  .BYTE $F8,$F4,$98,$34,$F8,$54,$A8,$00,$F8,$E3,$8F,$BE,$F8,$E3,$8F,$BE
  .BYTE $E0,$D0,$E0,$50,$E0,$FF,$8F,$3E,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $07,$01,$02,$00,$2A,$8A,$A0,$C0,$FA,$63,$AF,$3E,$BE,$95,$0B,$01
  .BYTE $88,$F3,$8F,$3E,$FF,$F5,$9A,$34,$FE,$D5,$AA,$C0,$AA,$4A,$A0,$00
  .BYTE $38,$23,$2F,$3E,$B8,$A3,$2F,$3E,$F8,$F4,$98,$34,$F8,$EF,$8F,$3E
  .BYTE $00,$00,$00,$00,$00,$FF,$8F,$3E,$01,$01,$01,$01,$09,$E1,$A9,$31
  .BYTE $F8,$E3,$8F,$3E,$F8,$E3,$8F,$3E,$A2,$C3,$A3,$C2,$AA,$CB,$A3,$C2
  .BYTE $F9,$E3,$8F,$3F,$F9,$E3,$8F,$3F,$88,$4B,$8F,$4E,$88,$4B,$8F,$4E
  .BYTE $FE,$E5,$8E,$3D,$FE,$E3,$8F,$3E,$18,$13,$1F,$1E,$18,$E3,$8F,$3F
  .BYTE $FA,$EC,$8A,$3C,$FA,$54,$AA,$40,$78,$63,$4F,$7E,$78,$63,$4F,$7E
  .BYTE $E8,$F0,$A8,$30,$E8,$FF,$8F,$3E,$00,$00,$00,$00,$00,$FF,$8F,$3E
  .BYTE $02,$03,$03,$02,$0A,$C3,$E3,$52,$F8,$E3,$8F,$3F,$F9,$E3,$8F,$3F
  .BYTE $FA,$57,$AF,$46,$84,$47,$87,$46,$00,$FE,$8E,$3F,$FA,$E3,$8E,$3F
  .BYTE $00,$00,$80,$00,$AA,$2A,$80,$00,$00,$00,$00,$00,$AA,$AA,$00,$00
  .BYTE $00,$00,$AA,$AA,$00,$00,$FF,$FF,$00,$00,$AA,$AA,$00,$00,$FF,$FF
  .BYTE $03,$01,$A8,$A8,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$E0,$50,$A2,$02,$00,$00,$FF,$FF
  .BYTE $1F,$05,$AA,$A0,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $E0,$50,$A2,$02,$00,$00,$FF,$FF,$1F,$05,$AA,$A0,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$FE,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $80,$00,$AA,$2A,$00,$00,$FF,$FF,$FF,$55,$2A,$00,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $A0,$40,$AA,$0A,$00,$00,$FF,$FF,$01,$00,$AA,$AA,$00,$00,$FF,$FF
  .BYTE $F8,$54,$A8,$00,$00,$00,$FF,$FF,$00,$00,$AA,$AA,$00,$00,$FF,$FF
  .BYTE $3F,$15,$8A,$80,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$E9,$50,$AA,$02,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$A3,$41,$A8,$08,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$8F,$45,$82,$00,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $80,$40,$8A,$0A,$00,$00,$FF,$FF,$7F,$15,$AA,$80,$00,$00,$FF,$FF
  .BYTE $FF,$55,$AA,$00,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $E3,$51,$A0,$00,$00,$00,$FF,$FF,$FF,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $87,$41,$8A,$08,$00,$00,$FF,$FF,$FE,$55,$AA,$00,$00,$00,$FF,$FF
  .BYTE $80,$00,$AA,$2A,$00,$00,$FF,$FF,$00,$00,$AA,$AA,$00,$00,$FF,$FF
