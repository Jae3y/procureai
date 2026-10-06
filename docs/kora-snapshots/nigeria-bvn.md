---
updatedAt: 2025-02-28T00:12:40.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Bank Verification Number (BVN)

## BVN Lookup API

To perform verification on a Bank Verification Number (BVN), make a POST request to the BVN Lookup endpoint;

`https://api.korapay.com/merchant/api/v1/identities/ng/bvn`

## BVN Data Validation

BVN data validation enables you to verify a BVN and validate the information in the government database against the data parameters you provided when the verification request was made. You can validate the First name, Last name and DOB of the BVN holder by passing the information in the request body to get a `true` or `false` response when matched with the information in the database. Use the same endpoint above to make this request.

## BVN Facial Matching

BVN facial matching enables you to match the BVN holder’s image in the government database against the image provided when the verification request was made. A confidence score of how well the images match will be returned. Use the same endpoint above to make this request.

<br />

The request body should have the following parameters:

```json Lookup
{
  "id": "22222222222",
  "verification_consent": true
}
```
```json With Data Matching
{
   "id": "22222222222",
   "verification_consent": true,
   "validation": {
       "first_name": "John",
       "last_name": "Doe",
       "date_of_birth": "1988-04-04"
   }
}
```
```json With Data and Facial Matching
{
   "id": "22222222222",
   "verification_consent": true,
   "validation": {
       "first_name": "John",
       "last_name": "Doe",
       "date_of_birth": "1988-04-04",
       "selfie": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"
   }
}
```

The fields in this request include:

| Field                      | Data Type | Description                                                                                                                                    |
| :------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | String    | **Required** - the ID number                                                                                                                   |
| `verification_consent`     | Boolean   | **Required** - this indicates that subject has given consent to perform this verification. This must be `true` for the check to be performed.  |
| `validation.first_name`    | String    | **Optional (required for data matching)** - the first name of the ID holder to be compared with ID information in the government database.     |
| `validation.last_name`     | String    | **Optional (required for data matching)** - the last name of the ID holder to be compared with ID information in the government database.      |
| `validation.date_of_birth` | String    | **Optional (required for data matching)** - the date of birth of the ID holder to be compared with ID information in the government database.  |
| `validation.selfie`        | String    | **Optional (required for facial matching)** - the selfie/photo of the ID holder to be compared with ID information in the government database. |

The response to this request would look like this:

```json Response
{
   "status": true,
   "message": "BVN verified successfully",
   "data": {
       "reference": "VR-dSFV9EuR2WCcHXuqm",
       "id": "22222222222",
       "id_type": "ng_bvn",
       "first_name": "Trevor",
       "last_name": "Mandela",
       "middle_name": null,
       "date_of_birth": "1989-07-08",
       "phone_number": "08031234567",
       "gender": "male",
       "enrollment_branch": null,
       "enrollment_institution": null,
       "registration_date": "2005-11-11",
       "nin": "55555555555",
       "level_of_account": null,
       "address": {
           "town": null,
           "lga": null,
           "state": null,
           "street": null
       },
       "title": null,
       "marital_status": null,
       "lga_of_origin": null,
       "other_mobile": null,
       "state_of_origin": null,
       "watch_listed": null,
       "name_on_card": null,
       "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ",
       "validation": {
           "first_name": {
               "value": "Viola",
               "match": false
           },
           "last_name": {
               "value": "doe",
               "match": false
           },
           "date_of_birth": {
               "value": "1988-10-16",
               "match": false
           },
           "selfie": {
               "value": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ",
               "match": true
           }
       },
       "requested_by": "API User"
   }
}
```