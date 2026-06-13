# LokLM — Third-Party Notices

LokLM is distributed under the MIT License. It bundles or links to the
third-party components listed below. The bundle copy of these projects is
unmodified; modifications (if any) are tracked in this repository's git
history under `vendor/` or as explicit patches.

This file is the canonical source. The in-app "Settings → About" tab renders
a summarized version of it for end users.

---

## Apache-2.0 components — npm packages (shipped)

The following packages are licensed under the **Apache License,
Version 2.0**. The full license text is reproduced at the bottom of this
file. None of these packages ship a separate `NOTICE` file as part of their
npm distribution, so no further attribution beyond the entries below is
required.

### @electric-sql/pglite

- Copyright (c) ElectricSQL and contributors
- Source: https://github.com/electric-sql/pglite
- Use in LokLM: in-process PostgreSQL via WASM, backs the workspace metadata DB.

### drizzle-orm

- Copyright (c) Drizzle Team and contributors
- Source: https://github.com/drizzle-team/drizzle-orm
- Use in LokLM: typed SQL builder + migration runner against PGlite.

### pdf-parse

- Copyright (c) Modesty Zhang
- Source: https://gitlab.com/autokent/pdf-parse
- Use in LokLM: text extraction for ingested PDF documents.

### pdfjs-dist

- Copyright (c) Mozilla Foundation and contributors
- Source: https://github.com/mozilla/pdf.js
- Use in LokLM: PDF rendering and page-level text extraction fallback.

### eld (Efficient Language Detector)

- Copyright (c) Nito T.M.
- Source: https://github.com/nitotm/efficient-language-detector-js
- Use in LokLM: per-chunk language tagging during ingest.

### sharp

- Copyright (c) Lovell Fuller and contributors
- Source: https://github.com/lovell/sharp
- Use in LokLM: image decoding and OCR preprocessing (grayscale, contrast
  normalisation, upscaling) for ingested images.
- Note: the prebuilt `@img/sharp-<platform>` binaries bundle the libvips
  runtime, which is licensed LGPL-3.0-or-later — see the dedicated libvips
  section below.

### sherpa-onnx (via sherpa-onnx-node)

- Copyright (c) Xiaomi Corporation and k2-fsa contributors
- Source: https://github.com/k2-fsa/sherpa-onnx
- Use in LokLM: speaker-diarization runtime (segmentation + speaker
  embedding inference).

### tesseract.js (and tesseract.js-core)

- Copyright (c) Tesseract.js contributors; Tesseract OCR engine
  Copyright (c) Google and contributors
- Source: https://github.com/naptha/tesseract.js
- Use in LokLM: OCR for scanned PDFs and ingested images.

---

## Apache-2.0 components — model weights and data (shipped)

Model files are downloaded by the installer wizard (or the in-app model
picker) into the install's `models/` directory and are subject to their
upstream licenses. The following are released under Apache 2.0:

### Qwen3.5-2B / Qwen3.5-4B / Qwen3.5-9B (GGUF, Q4_K_M)

- Copyright (c) Alibaba Cloud (Qwen Team)
- Source: https://huggingface.co/Qwen (GGUF quantizations via
  https://huggingface.co/unsloth, mirrored into LokLM HF buckets)
- Use in LokLM: local LLM ("lite" / "standard" / "pro" tiers).

### BGE-reranker-v2-m3 (GGUF, Q4_K_M)

- Copyright (c) Beijing Academy of Artificial Intelligence (BAAI)
- Source: https://huggingface.co/BAAI/bge-reranker-v2-m3
- Use in LokLM: cross-encoder reranking of retrieved chunks.

### 3D-Speaker ERes2Net speaker embedding (ONNX)

- Copyright (c) Alibaba, Inc. and its affiliates (3D-Speaker / ModelScope)
- Source: https://github.com/modelscope/3D-Speaker (ONNX export via
  https://github.com/k2-fsa/sherpa-onnx)
- Use in LokLM: speaker embedding for diarization.

### Tesseract traineddata (eng + deu)

- Copyright (c) Google and Tesseract OCR contributors
- Source: https://github.com/tesseract-ocr/tessdata_best
- Use in LokLM: OCR language models, bundled as app resources.

---

## MIT components (shipped, courtesy)

MIT does not require a separate NOTICE entry; the principal MIT components
are listed here as a courtesy.

### BGE-M3 (GGUF, Q4_K_M)

- Copyright (c) Beijing Academy of Artificial Intelligence (BAAI)
- Source: https://huggingface.co/BAAI/bge-m3
- Use in LokLM: workspace embedding.

### Whisper weights (ggml; base bundled, tiny/small/medium downloadable)

- Copyright (c) OpenAI (weights); ggml conversion by Georgi Gerganov and
  contributors
- Source: https://huggingface.co/ggerganov/whisper.cpp
- Use in LokLM: audio transcription.

### pyannote segmentation-3.0 (ONNX)

- Copyright (c) pyannote (Hervé Bredin and contributors)
- Source: https://huggingface.co/pyannote/segmentation-3.0 (ONNX export via
  https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0)
- Use in LokLM: speech segmentation for diarization.

### npm packages

- argon2 — vault key derivation.
- sodium-native — mlock'd secure memory for the vault keys; bundles libsodium
  (both ISC, listed here for brevity).
- electron-log — application logging.
- node-llama-cpp — LLM runtime bindings (see llama.cpp section below).
- react / react-dom / react-markdown / remark-gfm — UI.
- @napi-rs/canvas — PDF page rasterisation for OCR; bundles Google's Skia
  (BSD-3-Clause).
- @kutalia/whisper-node-addon — transcription bindings; bundles whisper.cpp
  (also MIT).
- lucide-react — icons (ISC, listed here for brevity).

---

## BSD-2-Clause components (shipped, courtesy)

- mammoth — .docx → markdown extraction. Copyright (c) Michael Williamson.
- dotenv — environment configuration. Copyright (c) Scott Motte.

---

## Native runtime: llama.cpp via node-llama-cpp

llama.cpp (Georgi Gerganov and contributors) is bundled via the
`node-llama-cpp` npm package under the **MIT License**. Source:
https://github.com/ggml-org/llama.cpp.

---

## LGPL-3.0 component — libvips (via sharp)

The prebuilt `@img/sharp-<platform>` packages bundle the libvips image
processing library and its build of dependent libraries.

- Copyright (c) John Cupitt and libvips contributors
- Source: https://github.com/libvips/libvips (prebuilt via
  https://github.com/lovell/sharp-libvips)
- License: **LGPL-3.0-or-later**. The full LGPL-3.0 text is reproduced at
  the bottom of this file; it supplements the GNU GPL v3, available at
  https://www.gnu.org/licenses/gpl-3.0.txt and in the bundled package's
  own LICENSE file.
- LokLM links libvips dynamically: it ships as a separate shared library,
  unpacked outside the asar archive, so it can be replaced with a modified
  version as the LGPL requires. The bundled libvips is unmodified.

---

## Electron and Chromium

LokLM is an Electron application. Electron is MIT-licensed (Copyright (c)
Electron contributors / GitHub Inc.). Electron embeds Chromium and ffmpeg;
their licenses (BSD-3-Clause and LGPL-2.1 respectively, plus the licenses
of Chromium's bundled third-party components) ship verbatim next to the
application binary as `LICENSE.electron.txt` and `LICENSES.chromium.html`.
Chromium's ffmpeg build is linked dynamically.

---

## NVIDIA CUDA runtime libraries (CUDA-enabled installs only)

On systems where the installer selects GPU acceleration, the CUDA add-on
archive includes NVIDIA CUDA runtime redistributables (cudart, cuBLAS) as
shipped with the `@node-llama-cpp/<platform>-cuda` prebuilts. They are
redistributed as part of the application under the NVIDIA CUDA Toolkit
EULA: https://docs.nvidia.com/cuda/eula/. CPU-only installs do not include
these libraries.

---

## Apache License, Version 2.0 — full text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction,
    and distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by
    the copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all
    other entities that control, are controlled by, or are under common
    control with that entity. For the purposes of this definition,
    "control" means (i) the power, direct or indirect, to cause the
    direction or management of such entity, whether by contract or
    otherwise, or (ii) ownership of fifty percent (50%) or more of the
    outstanding shares, or (iii) beneficial ownership of such entity.

    "You" (or "Your") shall mean an individual or Legal Entity
    exercising permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation
    source, and configuration files.

    "Object" form shall mean any form resulting from mechanical
    transformation or translation of a Source form, including but
    not limited to compiled object code, generated documentation,
    and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or
    Object form, made available under the License, as indicated by a
    copyright notice that is included in or attached to the work
    (an example is provided in the Appendix below).

    "Derivative Works" shall mean any work, whether in Source or Object
    form, that is based on (or derived from) the Work and for which the
    editorial revisions, annotations, elaborations, or other modifications
    represent, as a whole, an original work of authorship. For the purposes
    of this License, Derivative Works shall not include works that remain
    separable from, or merely link (or bind by name) to the interfaces of,
    the Work and Derivative Works thereof.

    "Contribution" shall mean any work of authorship, including
    the original version of the Work and any modifications or additions
    to that Work or Derivative Works thereof, that is intentionally
    submitted to Licensor for inclusion in the Work by the copyright owner
    or by an individual or Legal Entity authorized to submit on behalf of
    the copyright owner. For the purposes of this definition, "submitted"
    means any form of electronic, verbal, or written communication sent
    to the Licensor or its representatives, including but not limited to
    communication on electronic mailing lists, source code control systems,
    and issue tracking systems that are managed by, or on behalf of, the
    Licensor for the purpose of discussing and improving the Work, but
    excluding communication that is conspicuously marked or otherwise
    designated in writing by the copyright owner as "Not a Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity
    on behalf of whom a Contribution has been received by Licensor and
    subsequently incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    copyright license to reproduce, prepare Derivative Works of,
    publicly display, publicly perform, sublicense, and distribute the
    Work and such Derivative Works in Source or Object form.

3.  Grant of Patent License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    (except as stated in this section) patent license to make, have made,
    use, offer to sell, sell, import, and otherwise transfer the Work,
    where such license applies only to those patent claims licensable
    by such Contributor that are necessarily infringed by their
    Contribution(s) alone or by combination of their Contribution(s)
    with the Work to which such Contribution(s) was submitted. If You
    institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work
    or a Contribution incorporated within the Work constitutes direct
    or contributory patent infringement, then any patent licenses
    granted to You under this License for that Work shall terminate
    as of the date such litigation is filed.

4.  Redistribution. You may reproduce and distribute copies of the
    Work or Derivative Works thereof in any medium, with or without
    modifications, and in Source or Object form, provided that You
    meet the following conditions:

    (a) You must give any other recipients of the Work or
    Derivative Works a copy of this License; and

    (b) You must cause any modified files to carry prominent notices
    stating that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works
    that You distribute, all copyright, patent, trademark, and
    attribution notices from the Source form of the Work,
    excluding those notices that do not pertain to any part of
    the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its
    distribution, then any Derivative Works that You distribute must
    include a readable copy of the attribution notices contained
    within such NOTICE file, excluding those notices that do not
    pertain to any part of the Derivative Works, in at least one
    of the following places: within a NOTICE text file distributed
    as part of the Derivative Works; within the Source form or
    documentation, if provided along with the Derivative Works; or,
    within a display generated by the Derivative Works, if and
    wherever such third-party notices normally appear. The contents
    of the NOTICE file are for informational purposes only and
    do not modify the License. You may add Your own attribution
    notices within Derivative Works that You distribute, alongside
    or as an addendum to the NOTICE text from the Work, provided
    that such additional attribution notices cannot be construed
    as modifying the License.

    You may add Your own copyright statement to Your modifications and
    may provide additional or different license terms and conditions
    for use, reproduction, or distribution of Your modifications, or
    for any such Derivative Works as a whole, provided Your use,
    reproduction, and distribution of the Work otherwise complies with
    the conditions stated in this License.

5.  Submission of Contributions. Unless You explicitly state otherwise,
    any Contribution intentionally submitted for inclusion in the Work
    by You to the Licensor shall be under the terms and conditions of
    this License, without any additional terms or conditions.
    Notwithstanding the above, nothing herein shall supersede or modify
    the terms of any separate license agreement you may have executed
    with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade
    names, trademarks, service marks, or product names of the Licensor,
    except as required for describing the origin of the Work and
    reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or
    agreed to in writing, Licensor provides the Work (and each
    Contributor provides its Contributions) on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
    implied, including, without limitation, any warranties or conditions
    of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
    PARTICULAR PURPOSE. You are solely responsible for determining the
    appropriateness of using or redistributing the Work and assume any
    risks associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory,
    whether in tort (including negligence), contract, or otherwise,
    unless required by applicable law (such as deliberate and grossly
    negligent acts) or agreed to in writing, shall any Contributor be
    liable to You for damages, including any direct, indirect, special,
    incidental, or consequential damages of any character arising as a
    result of this License or out of the use or inability to use the
    Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all
    other commercial damages or losses), even if such Contributor
    has been advised of the possibility of such damages.

9.  Accepting Warranty or Support. While redistributing the Work or
    Derivative Works thereof, You may choose to offer, and charge a
    fee for, acceptance of support, warranty, indemnity, or other
    liability obligations and/or rights consistent with this License.
    However, in accepting such obligations, You may act only on Your
    own behalf and on Your sole responsibility, not on behalf of any
    other Contributor, and only if You agree to indemnify, defend,
    and hold each Contributor harmless for any liability incurred by,
    or claims asserted against, such Contributor by reason of your
    accepting any such warranty or support.

END OF TERMS AND CONDITIONS

---

## GNU Lesser General Public License, Version 3 — full text

                   GNU LESSER GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
Everyone is permitted to copy and distribute verbatim copies
of this license document, but changing it is not allowed.

This version of the GNU Lesser General Public License incorporates
the terms and conditions of version 3 of the GNU General Public
License, supplemented by the additional permissions listed below.

0. Additional Definitions.

As used herein, "this License" refers to version 3 of the GNU Lesser
General Public License, and the "GNU GPL" refers to version 3 of the GNU
General Public License.

"The Library" refers to a covered work governed by this License,
other than an Application or a Combined Work as defined below.

An "Application" is any work that makes use of an interface provided
by the Library, but which is not otherwise based on the Library.
Defining a subclass of a class defined by the Library is deemed a mode
of using an interface provided by the Library.

A "Combined Work" is a work produced by combining or linking an
Application with the Library. The particular version of the Library
with which the Combined Work was made is also called the "Linked
Version".

The "Minimal Corresponding Source" for a Combined Work means the
Corresponding Source for the Combined Work, excluding any source code
for portions of the Combined Work that, considered in isolation, are
based on the Application, and not on the Linked Version.

The "Corresponding Application Code" for a Combined Work means the
object code and/or source code for the Application, including any data
and utility programs needed for reproducing the Combined Work from the
Application, but excluding the System Libraries of the Combined Work.

1. Exception to Section 3 of the GNU GPL.

You may convey a covered work under sections 3 and 4 of this License
without being bound by section 3 of the GNU GPL.

2. Conveying Modified Versions.

If you modify a copy of the Library, and, in your modifications, a
facility refers to a function or data to be supplied by an Application
that uses the facility (other than as an argument passed when the
facility is invoked), then you may convey a copy of the modified
version:

a) under this License, provided that you make a good faith effort to
ensure that, in the event an Application does not supply the
function or data, the facility still operates, and performs
whatever part of its purpose remains meaningful, or

b) under the GNU GPL, with none of the additional permissions of
this License applicable to that copy.

3. Object Code Incorporating Material from Library Header Files.

The object code form of an Application may incorporate material from
a header file that is part of the Library. You may convey such object
code under terms of your choice, provided that, if the incorporated
material is not limited to numerical parameters, data structure
layouts and accessors, or small macros, inline functions and templates
(ten or fewer lines in length), you do both of the following:

a) Give prominent notice with each copy of the object code that the
Library is used in it and that the Library and its use are
covered by this License.

b) Accompany the object code with a copy of the GNU GPL and this license
document.

4. Combined Works.

You may convey a Combined Work under terms of your choice that,
taken together, effectively do not restrict modification of the
portions of the Library contained in the Combined Work and reverse
engineering for debugging such modifications, if you also do each of
the following:

a) Give prominent notice with each copy of the Combined Work that
the Library is used in it and that the Library and its use are
covered by this License.

b) Accompany the Combined Work with a copy of the GNU GPL and this license
document.

c) For a Combined Work that displays copyright notices during
execution, include the copyright notice for the Library among
these notices, as well as a reference directing the user to the
copies of the GNU GPL and this license document.

d) Do one of the following:

       0) Convey the Minimal Corresponding Source under the terms of this
       License, and the Corresponding Application Code in a form
       suitable for, and under terms that permit, the user to
       recombine or relink the Application with a modified version of
       the Linked Version to produce a modified Combined Work, in the
       manner specified by section 6 of the GNU GPL for conveying
       Corresponding Source.

       1) Use a suitable shared library mechanism for linking with the
       Library.  A suitable mechanism is one that (a) uses at run time
       a copy of the Library already present on the user's computer
       system, and (b) will operate properly with a modified version
       of the Library that is interface-compatible with the Linked
       Version.

e) Provide Installation Information, but only if you would otherwise
be required to provide such information under section 6 of the
GNU GPL, and only to the extent that such information is
necessary to install and execute a modified version of the
Combined Work produced by recombining or relinking the
Application with a modified version of the Linked Version. (If
you use option 4d0, the Installation Information must accompany
the Minimal Corresponding Source and Corresponding Application
Code. If you use option 4d1, you must provide the Installation
Information in the manner specified by section 6 of the GNU GPL
for conveying Corresponding Source.)

5. Combined Libraries.

You may place library facilities that are a work based on the
Library side by side in a single library together with other library
facilities that are not Applications and are not covered by this
License, and convey such a combined library under terms of your
choice, if you do both of the following:

a) Accompany the combined library with a copy of the same work based
on the Library, uncombined with any other library facilities,
conveyed under the terms of this License.

b) Give prominent notice with the combined library that part of it
is a work based on the Library, and explaining where to find the
accompanying uncombined form of the same work.

6. Revised Versions of the GNU Lesser General Public License.

The Free Software Foundation may publish revised and/or new versions
of the GNU Lesser General Public License from time to time. Such new
versions will be similar in spirit to the present version, but may
differ in detail to address new problems or concerns.

Each version is given a distinguishing version number. If the
Library as you received it specifies that a certain numbered version
of the GNU Lesser General Public License "or any later version"
applies to it, you have the option of following the terms and
conditions either of that published version or of any later version
published by the Free Software Foundation. If the Library as you
received it does not specify a version number of the GNU Lesser
General Public License, you may choose any version of the GNU Lesser
General Public License ever published by the Free Software Foundation.

If the Library as you received it specifies that a proxy can decide
whether future versions of the GNU Lesser General Public License shall
apply, that proxy's public statement of acceptance of any version is
permanent authorization for you to choose that version for the
Library.
