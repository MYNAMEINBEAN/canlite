const socket = new WebSocket('ws://127.0.0.1/ws/' + localStorage.getItem('token') + '/' + localStorage.getItem('email'));
console.log('Connected')
socket.onmessage = function (event) {
    const data = event.data;
    const myObj = JSON.parse(data);
    if (myObj.action === "disconnect") {
        location.reload();
    }
}
console.log('Kept hoinh')