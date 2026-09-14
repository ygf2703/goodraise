# Landing-page illustration photographs

Created 2026-09-14 with the built-in image generation tool (`image_gen`), following the imagegen skill. These fictional blue-and-white community photographs replace the two empty image areas in `work/goodraise-landing.html`. Neither depicts the actual GoodRaise team or a real campaign. Each has a visible Hebrew illustration caption and descriptive alternative text.

## Project assets

- `work/assets/landing-community-hero.webp` — 1200 × 1200; volunteers packing donations.
- `work/assets/landing-community-hero-640.webp` — 640 × 640 responsive variant.
- `work/assets/landing-community-planning.webp` — 1200 × 800; planning a community initiative.
- `work/assets/landing-community-planning-640.webp` — 640 × 427 responsive variant.

The generated photographs were encoded as WebP with `cwebp` (quality 84 for the larger images and 82 for the smaller variants). The hero has high fetch priority; the lower image loads lazily. The existing asset preparation copies all four files into the public assets directory. Source images remain in the image generator's output directory.

## Final generation prompts

### Hero

```text
Use case: photorealistic-natural
Asset type: GoodRaise community fundraising landing-page hero photograph.
Primary request: A warm, candid photograph of adult community volunteers packing donation boxes, rendered entirely in blue and white.
Scene/backdrop: A bright modest community room with daylight through a large window, subtly blurred shelves behind a worktable.
Subject: Three fictional adult volunteers of varied ages, two women and one man, collaborating naturally as they pack unbranded groceries into a cardboard donation box. Warm, genuine expressions, focused on the shared activity, no posing for the camera.
Style/medium: Photorealistic editorial photography with a refined monochrome blue-and-white duotone treatment. Natural faces, hands, fabric texture and corrugated cardboard.
Composition/framing: Square image, medium shot at eye level; keep faces and the shared box within the central 75% so the image can be cropped for mobile. Leave the upper-left corner visually calm for an existing small round badge. No text within the image.
Lighting/mood: Soft bright daylight, hopeful, human, unpretentious.
Color palette: White and pale blue highlights, medium blue #075eb5 and navy #102d4c shadows. No other hues. Clear tonal separation so faces stay readable.
Constraints: Fictional people only; no logos, labels, watermarks, text, flags, symbols, UI, frames, decorative icons, or charity names. Full-bleed photo, not a webpage mockup.
```

### Community planning

```text
Use case: photorealistic-natural
Asset type: GoodRaise landing-page about/community photograph.
Primary request: A candid detail photograph of people planning a community initiative together, rendered entirely in blue and white.
Scene/backdrop: A sunlit worktable in a simple community space.
Subject: Several adult volunteers gathered at a table, seen from a slightly elevated three-quarter angle, their hands arranging plain paper notes beside an open blank notebook and a small unbranded laptop. Include relaxed partial upper bodies; the shared work and one person smiling toward a teammate are the focal point. A natural, believable working moment, not a staged stock-photo hand stack.
Style/medium: Photorealistic editorial photography with a refined monochrome blue-and-white duotone treatment, natural fabric, paper grain and realistic hands.
Composition/framing: Landscape 3:2, close-medium framing with the shared notebook and people in the central area; composition remains readable when cropped to 16:10. Full bleed, no baked-in text.
Lighting/mood: Soft daylight, collaborative, thoughtful, optimistic.
Color palette: White and pale blue highlights with #075eb5 blues and #102d4c navy shadows; no other hues.
Constraints: Fictional people only; blank papers, no readable screens, no logos, labels, watermarks, flags, symbols, frames, or added UI. This is an illustrative community photo, not a photograph of GoodRaise's actual team.
```
