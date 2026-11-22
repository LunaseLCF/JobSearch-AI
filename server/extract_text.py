#!/usr/bin/env python3
"""Extract text from PDF, DOC/DOCX, TXT, or HTML resume files.

Modern Word files saved with a .doc extension are still ZIP-based DOCX files;
legacy .doc files are OLE2 compound documents. Both are detected by file
signature rather than relying on the extension alone.
"""
import os
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

# Chinese text must reach Node as UTF-8 regardless of the Windows console code page.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

OLE2_SIGNATURE = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'
ZIP_SIGNATURE = b'PK\x03\x04'


def read_signature(filepath):
    try:
        with open(filepath, 'rb') as f:
            return f.read(8)
    except Exception:
        return b''


def is_zip_file(filepath):
    return read_signature(filepath).startswith(ZIP_SIGNATURE)


def is_ole_file(filepath):
    return read_signature(filepath) == OLE2_SIGNATURE


def extract_pdf(filepath):
    primary = ''
    try:
        from pypdf import PdfReader
        reader = PdfReader(filepath)
        texts = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                texts.append(t)
        primary = "\n".join(texts)
    except Exception as e:
        primary = f"ERROR_PDF: {e}"

    # Many Chinese CV PDFs use embedded subset fonts that pypdf cannot map.
    # PyMuPDF usually recovers the text; use it when pypdf found little or mojibake.
    needs_fallback = (
        primary.startswith('ERROR_PDF')
        or len(primary.strip()) < 40
        or primary.count('\ufffd') > 2
        or (len(primary) > 0 and not re.search(r'[A-Za-z\u4e00-\u9fff]', primary))
    )
    if needs_fallback:
        try:
            import fitz  # PyMuPDF
            with fitz.open(filepath) as doc:
                fallback = "\n".join(page.get_text('text') for page in doc)
            if len(fallback.strip()) > len(primary.strip()) and '\ufffd' not in fallback:
                return fallback
        except Exception:
            pass
    if primary.startswith('ERROR_PDF'):
        return primary
    if len(primary.strip()) < 5:
        return "ERROR_NO_TEXT: no readable text layer found (the PDF may be a scan or image)"
    return primary


def extract_docx_textboxes(filepath):
    """Chinese CV templates often put content in text boxes, which python-docx misses."""
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    lines = []
    try:
        with zipfile.ZipFile(filepath) as archive:
            for name in archive.namelist():
                if not (name.startswith('word/') and name.endswith('.xml')):
                    continue
                root = ET.fromstring(archive.read(name))
                for box in root.iter(ns + 'txbxContent'):
                    for para in box.iter(ns + 'p'):
                        text = ''.join(node.text or '' for node in para.iter(ns + 't')).strip()
                        if text:
                            lines.append(text)
    except Exception:
        pass
    return lines


def extract_docx(filepath):
    try:
        import docx
        doc = docx.Document(filepath)
        texts = []
        for para in doc.paragraphs:
            if para.text.strip():
                texts.append(para.text)
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text.strip():
                        texts.append(cell.text.strip())
        for line in extract_docx_textboxes(filepath):
            if line not in texts:
                texts.append(line)
        return "\n".join(texts)
    except Exception as e:
        return f"ERROR_DOCX: {e}"


def extract_legacy_doc(filepath):
    """Use Microsoft Word (COM) on Windows to read a legacy binary .doc file."""
    filepath = os.path.abspath(filepath)
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extract_doc.ps1')
    if not os.path.exists(script):
        return "ERROR_DOC: Word extraction helper not found"
    if os.name != 'nt':
        return "ERROR_DOC: legacy .doc extraction requires Windows Word"
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
             '-File', script, filepath],
            capture_output=True,
            encoding='utf-8',
            errors='replace',
            timeout=120,
        )
        text = (result.stdout or '').strip()
        if result.returncode != 0 or not text:
            detail = (result.stderr or '').strip() or 'Word returned no text'
            return f"ERROR_DOC: {detail}"
        return text
    except Exception as e:
        return f"ERROR_DOC: {e}"


def extract_doc(filepath):
    # A .doc file may actually be a DOCX (ZIP) that was renamed.
    if is_zip_file(filepath):
        return extract_docx(filepath)
    # Genuine legacy Word binary.
    if is_ole_file(filepath):
        return extract_legacy_doc(filepath)
    # Some tools produce RTF/HTML/plain text with a .doc extension.
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        head = f.read(4096).lstrip().lower()
    if head.startswith('{\\rtf'):
        return extract_txt(filepath)
    if '<html' in head or '<!doctype' in head or '<body' in head:
        return extract_html(filepath)
    return extract_txt(filepath)


def extract_txt(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except Exception as e:
        return f"ERROR_TXT: {e}"


def extract_html(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
        content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)
        content = re.sub(r'<[^>]+>', ' ', content)
        content = re.sub(r'&nbsp;', ' ', content)
        content = re.sub(r'&amp;', '&', content)
        content = re.sub(r'&lt;', '<', content)
        content = re.sub(r'&gt;', '>', content)
        content = re.sub(r'\s+', ' ', content).strip()
        return content
    except Exception as e:
        return f"ERROR_HTML: {e}"


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("ERROR: No file path provided")
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print("ERROR: File not found")
        sys.exit(1)

    ext = os.path.splitext(filepath)[1].lower()

    if ext == '.pdf':
        print(extract_pdf(filepath))
    elif ext in ('.docx', '.doc'):
        print(extract_doc(filepath) if ext == '.doc' else (extract_docx(filepath) if is_zip_file(filepath) else extract_doc(filepath)))
    elif ext in ('.txt', '.md', '.tex'):
        print(extract_txt(filepath))
    elif ext in ('.html', '.htm'):
        print(extract_html(filepath))
    else:
        print(extract_txt(filepath))
