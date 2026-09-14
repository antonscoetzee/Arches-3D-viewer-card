# urls_range_patch.py
#
# Drop-in replacement for your Arches project's <project_name>/urls.py.
#
# WHAT THIS ADDS over the stock Arches 8.1 urls.py:
#   - ranged_media_serve: a view that handles HTTP Range requests (RFC 7233).
#     Required by nexus.js when streaming NXS/NXZ files — Django's built-in
#     FileResponse returns 200 for range requests; nexus.js only processes 206.
#
# HOW TO APPLY:
#   Copy this file to <your_project>/<project_name>/urls.py
#   If you already have project-level URL patterns, add them to the
#   urlpatterns list at the top.
#
# NGINX / PRODUCTION NOTE:
#   This view is only needed when Django itself is serving media files (i.e.
#   DEBUG=True dev server, or Gunicorn without a proxy handling /files/).
#   If nginx proxies the /files/ path directly to the filesystem it will
#   handle Range requests natively — this view will never be reached.

import mimetypes
from pathlib import Path
from django.conf import settings
from django.conf.urls.static import static
from django.conf.urls.i18n import i18n_patterns
from django.urls import include, path
from django.http import HttpResponse, HttpResponseNotFound, HttpResponseForbidden
from django.views.decorators.http import require_GET


@require_GET
def ranged_media_serve(request, path):
    """Serve media files with HTTP Range support (required by nexus.js for NXS/NXZ)."""
    media_root = Path(settings.MEDIA_ROOT)
    try:
        fullpath = (media_root / path).resolve()
        fullpath.relative_to(media_root.resolve())
    except (ValueError, Exception):
        return HttpResponseForbidden()

    if not fullpath.is_file():
        return HttpResponseNotFound()

    content_type, _ = mimetypes.guess_type(str(fullpath))
    content_type = content_type or "application/octet-stream"
    file_size = fullpath.stat().st_size

    range_header = request.META.get("HTTP_RANGE", "")
    if not range_header or not range_header.startswith("bytes="):
        response = HttpResponse(content_type=content_type)
        response["Accept-Ranges"] = "bytes"
        response["Content-Length"] = file_size
        with fullpath.open("rb") as f:
            response.content = f.read()
        return response

    try:
        ranges_part = range_header[6:]
        parts = ranges_part.split("-", 1)
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
    except (ValueError, IndexError):
        response = HttpResponse(status=416)
        response["Content-Range"] = f"bytes */{file_size}"
        return response

    start = max(0, start)
    end = min(end, file_size - 1)
    length = end - start + 1

    with fullpath.open("rb") as f:
        f.seek(start)
        data = f.read(length)

    response = HttpResponse(data, status=206, content_type=content_type)
    response["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    response["Accept-Ranges"] = "bytes"
    response["Content-Length"] = length
    return response


urlpatterns = [
    # ── Add any project-level URL patterns here ──────────────────────────────
]

# Arches core URLs (must come before the media range handler so Arches routes
# such as /files/<uuid> still redirect to the actual media path first).
urlpatterns.append(path("", include("arches.urls")))

# Range-aware media file serving.
# Must be registered BEFORE static() so it intercepts requests under MEDIA_URL.
urlpatterns.append(
    path(
        settings.MEDIA_URL.lstrip("/") + "<path:path>",
        ranged_media_serve,
    )
)

# Fallback: standard Django static media serving (no Range support).
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Only handle i18n routing in the active project.
if settings.ROOT_URLCONF == __name__:
    if settings.SHOW_LANGUAGE_SWITCH is True:
        urlpatterns = i18n_patterns(*urlpatterns)

    urlpatterns.append(path("i18n/", include("django.conf.urls.i18n")))
