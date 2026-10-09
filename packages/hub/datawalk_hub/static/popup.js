// Sign-in from an embedded report (SharePoint, Confluence, Teams): tell the frame, then close.
if (window.opener) {
  window.opener.postMessage('datawalk-signed-in', location.origin)
  window.close()
}
