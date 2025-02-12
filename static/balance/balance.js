axios.post('https://api.everyonegetsnews.org/refresh', {
    token: window.localStorage.getItem('token'),
    email: window.localStorage.getItem('email')
})
    .then(function (responseAxios) {
        if (responseAxios.status === 200) {
            const userObject = JSON.parse(responseAxios.data);
            document.getElementById('address').textContent = userObject.address;
            document.getElementById('qr').setAttribute('src', "data:image/jpg;base64," + userObject.qr);
        } else {
            console.log(responseAxios);
        }
    })
    .catch(function (error) {
        console.log(error);
    });